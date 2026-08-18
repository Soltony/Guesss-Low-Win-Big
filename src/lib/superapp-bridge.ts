'use client';

import { CHANNEL_NAME } from './superapp-channel';

/**
 * Hand-off from the mini app to the native super-app shell.
 *
 * The gateway does not ask the customer for their PIN itself. It answers our
 * charge request with a signed payment token addressed to the host app
 * (`aud: NibteraMiniApp`) and expects the webview to pass that token out
 * through the JS channel; the host is what raises the PIN sheet. Until the
 * hand-off happens nothing prompts the customer, the gateway never calls our
 * callback, and the bid sits at PENDING_PAYMENT until the poll gives up.
 *
 * Every super-app build exposes the channel differently — Android's
 * `addJavascriptInterface`, iOS's `messageHandlers`, a Flutter handler — so
 * each known shape is tried in turn. The outcome, and a description of what the
 * host actually exposes, is reported back to the server: a webview on a phone
 * has no console anyone can read.
 */

type Attempt = { channel: string; delivered: boolean; error?: string };

export interface HandoffResult {
  delivered: boolean;
  /** The channel shape that accepted the token, once one did. */
  via: string | null;
  attempts: Attempt[];
  /** What this host exposes — the evidence when no known shape matches. */
  host: Record<string, unknown>;
}

/** Probes the host without calling anything, so a miss can be diagnosed. */
function inspectHost(): Record<string, unknown> {
  if (typeof window === 'undefined') return { note: 'no window' };
  const w = window as any;

  let globals: string[] = [];
  try {
    globals = Object.getOwnPropertyNames(w)
      .filter((k) => /channel|bridge|webkit|flutter|android|native|jsinterface|superapp|nib|tera/i.test(k))
      .slice(0, 40);
  } catch {
    /* some hosts throw on enumeration */
  }

  return {
    userAgent: navigator.userAgent,
    isIframe: window.parent !== window,
    channelLookingGlobals: globals,
    [`typeof window.${CHANNEL_NAME}`]: typeof w[CHANNEL_NAME],
    [`typeof window.${CHANNEL_NAME}.postMessage`]: typeof w[CHANNEL_NAME]?.postMessage,
    'webkit.messageHandlers': w.webkit?.messageHandlers
      ? Object.keys(w.webkit.messageHandlers).slice(0, 20)
      : null,
    'typeof flutter_inappwebview.callHandler': typeof w.flutter_inappwebview?.callHandler,
    'typeof ReactNativeWebView.postMessage': typeof w.ReactNativeWebView?.postMessage,
  };
}

/**
 * Passes the gateway's payment token to the host so it can ask for the PIN.
 *
 * The token goes across as the bare string the gateway issued: it is opaque to
 * us and the host decodes it itself. If a build turns out to want an envelope
 * instead, that is the one line to change.
 */
export function requestWalletApproval(paymentToken: string): HandoffResult {
  const attempts: Attempt[] = [];
  const host = inspectHost();

  if (typeof window === 'undefined') {
    return { delivered: false, via: null, attempts, host };
  }
  const w = window as any;

  const routes: Array<[string, () => boolean]> = [
    // Android: webView.addJavascriptInterface(obj, "MyJsChannel")
    [
      `${CHANNEL_NAME}.postMessage`,
      () => {
        if (typeof w[CHANNEL_NAME]?.postMessage !== 'function') return false;
        w[CHANNEL_NAME].postMessage(paymentToken);
        return true;
      },
    ],
    // iOS WKWebView: userContentController.add(handler, name: "MyJsChannel")
    [
      `webkit.messageHandlers.${CHANNEL_NAME}.postMessage`,
      () => {
        if (typeof w.webkit?.messageHandlers?.[CHANNEL_NAME]?.postMessage !== 'function') return false;
        w.webkit.messageHandlers[CHANNEL_NAME].postMessage(paymentToken);
        return true;
      },
    ],
    // Flutter InAppWebView
    [
      `flutter_inappwebview.callHandler(${CHANNEL_NAME})`,
      () => {
        if (typeof w.flutter_inappwebview?.callHandler !== 'function') return false;
        w.flutter_inappwebview.callHandler(CHANNEL_NAME, paymentToken);
        return true;
      },
    ],
    // React Native WebView
    [
      'ReactNativeWebView.postMessage',
      () => {
        if (typeof w.ReactNativeWebView?.postMessage !== 'function') return false;
        w.ReactNativeWebView.postMessage(paymentToken);
        return true;
      },
    ],
    // Some hosts bind the interface as a bare function rather than an object.
    [
      `${CHANNEL_NAME}()`,
      () => {
        if (typeof w[CHANNEL_NAME] !== 'function') return false;
        w[CHANNEL_NAME](paymentToken);
        return true;
      },
    ],
  ];

  for (const [channel, send] of routes) {
    try {
      if (send()) {
        attempts.push({ channel, delivered: true });
        return { delivered: true, via: channel, attempts, host };
      }
      attempts.push({ channel, delivered: false, error: 'not present on this host' });
    } catch (error: any) {
      attempts.push({ channel, delivered: false, error: error?.message || String(error) });
    }
  }

  return { delivered: false, via: null, attempts, host };
}

/** Mirrors the hand-off into the server log; the phone has no console to read. */
export async function reportHandoff(payload: Record<string, unknown>) {
  try {
    await fetch('/api/miniapp/debug/bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
  } catch {
    // Diagnostics must never break a bid.
  }
}
