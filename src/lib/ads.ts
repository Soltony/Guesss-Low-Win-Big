import prisma from './prisma';
import { getSettings } from './settings';
import {
  AD_FREQUENCIES,
  AD_PLACEMENTS,
  MAX_AUTO_CLOSE_SECONDS,
  MAX_MIN_VIEW_SECONDS,
} from './types';
import type { AdFrequency, AdPlacement } from './types';

/**
 * Mini-app advertisement popups.
 *
 * Which ad a bidder sees is decided entirely on the server: the client asks
 * once per app open and renders whatever comes back, so nothing about the
 * schedule or the frequency caps can be bypassed from the webview.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Shape sent to the mini-app. Both languages ship so the popup follows the
 *  in-app language toggle without another round trip. */
export interface PopupAd {
  id: string;
  title: string;
  titleAm: string | null;
  body: string | null;
  bodyAm: string | null;
  imageUrl: string | null;
  /** Text alternative for the artwork; null means it is purely decorative. */
  imageAlt: string | null;
  ctaLabel: string | null;
  ctaLabelAm: string | null;
  linkUrl: string | null;
  autoCloseSeconds: number;
  minViewSeconds: number;
}

export function isAdFrequency(value: unknown): value is AdFrequency {
  return AD_FREQUENCIES.includes(value as AdFrequency);
}

export function isAdPlacement(value: unknown): value is AdPlacement {
  return AD_PLACEMENTS.includes(value as AdPlacement);
}

/**
 * Validates the run window on the admin ad form. Returns the message instead of
 * throwing so create and edit answer with identical wording.
 */
export function parseAdSchedule(
  body: Record<string, any>
): { startAt: Date | null; endAt: Date | null } | { error: string } {
  const startAt = body.startAt ? new Date(body.startAt) : null;
  const endAt = body.endAt ? new Date(body.endAt) : null;

  if (startAt && Number.isNaN(startAt.getTime())) return { error: 'Start date is invalid.' };
  if (endAt && Number.isNaN(endAt.getTime())) return { error: 'End date is invalid.' };
  if (startAt && endAt && endAt <= startAt) {
    return { error: 'The end date must be after the start date.' };
  }
  return { startAt, endAt };
}

/**
 * Clamps the two countdowns and rejects the one combination that would strand
 * a bidder: an ad that closes itself before its forced view has elapsed.
 */
export function parseAdTimings(
  minViewInput: unknown,
  autoCloseInput: unknown
): { minViewSeconds: number; autoCloseSeconds: number } | { error: string } {
  const minViewSeconds = Math.min(
    MAX_MIN_VIEW_SECONDS,
    Math.max(0, Math.trunc(Number(minViewInput) || 0))
  );
  const autoCloseSeconds = Math.min(
    MAX_AUTO_CLOSE_SECONDS,
    Math.max(0, Math.trunc(Number(autoCloseInput) || 0))
  );

  if (autoCloseSeconds > 0 && autoCloseSeconds < minViewSeconds) {
    return {
      error: `Auto-close must be at least as long as the forced view (${minViewSeconds}s), or 0 to leave the popup up.`,
    };
  }
  return { minViewSeconds, autoCloseSeconds };
}

/** True when this bidder is allowed to see the ad again right now. */
function isDue(
  frequency: string,
  view: { lastSeenAt: Date } | undefined,
  now: Date
): boolean {
  if (!view) return true;
  if (frequency === 'ONCE') return false;
  if (frequency === 'ONCE_PER_DAY') return now.getTime() - view.lastSeenAt.getTime() >= DAY_MS;
  return true; // EVERY_LOGIN
}

/**
 * Ads due for one bidder, already trimmed to the per-visit cap.
 *
 * Serving is not seeing: with a cap above 1 the batch is a queue the bidder
 * works through one card at a time, and they may close the app after the first.
 * Impressions are therefore recorded by `recordAdView` as each card actually
 * reaches the screen — counting them here would burn the frequency cap of ads
 * nobody ever laid eyes on.
 */
export async function popupAdsForBidder(bidder: {
  bidderId: string;
  isTest?: boolean;
  /** The current sign-in, from the session cookie. One batch per sign-in. */
  sessionId?: string;
}): Promise<{ ads: PopupAd[]; delaySeconds: number }> {
  const settings = await getSettings();
  const empty = { ads: [], delaySeconds: 0 };

  if (!settings['ads.enabled']) return empty;
  if (bidder.isTest && !settings['ads.showToTestSessions']) return empty;

  const limit = Math.max(1, Number(settings['ads.maxPerLogin']) || 1);
  const delaySeconds = Math.max(0, Number(settings['ads.delaySeconds']) || 0);
  const now = new Date();

  const candidates = await prisma.advertisement.findMany({
    where: {
      status: 'ACTIVE',
      placement: 'POST_LOGIN',
      AND: [
        { OR: [{ startAt: null }, { startAt: { lte: now } }] },
        { OR: [{ endAt: null }, { endAt: { gte: now } }] },
      ],
    },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    include: { views: { where: { bidderId: bidder.bidderId } } },
  });

  const due = candidates.filter((ad) => isDue(ad.frequency, ad.views[0], now)).slice(0, limit);
  if (due.length === 0) return { ads: [], delaySeconds };

  // Claimed only once there is something to show, so a quiet visit does not
  // spend the sign-in's one batch.
  if (!(await claimSignIn(bidder.bidderId, bidder.sessionId))) {
    return { ads: [], delaySeconds };
  }

  return {
    delaySeconds,
    ads: due.map((ad) => ({
      id: ad.id,
      title: ad.title,
      titleAm: ad.titleAm,
      body: ad.body,
      bodyAm: ad.bodyAm,
      imageUrl: ad.imageUrl,
      imageAlt: ad.imageAlt,
      ctaLabel: ad.ctaLabel,
      ctaLabelAm: ad.ctaLabelAm,
      linkUrl: ad.linkUrl,
      autoCloseSeconds: ad.autoCloseSeconds,
      minViewSeconds: ad.minViewSeconds,
    })),
  };
}

/**
 * Marks this sign-in as having been served its popup batch, and reports whether
 * the caller is the one that claimed it.
 *
 * Every mini-app page mounts its own shell, so a bidder browsing three pages
 * asks three times; without this they would be shown the popup on each. The
 * conditional UPDATE is what makes it safe — two page loads racing can never
 * both come back true.
 *
 * Sessions issued before `sid` existed all share the `legacy` marker: they get
 * one batch and nothing more until the cookie is reissued, which errs toward
 * showing too few popups rather than too many.
 */
async function claimSignIn(bidderId: string, sessionId?: string) {
  const marker = sessionId || 'legacy';

  const claimed = await prisma.bidder.updateMany({
    where: {
      id: bidderId,
      OR: [{ lastAdSessionId: null }, { lastAdSessionId: { not: marker } }],
    },
    data: { lastAdSessionId: marker },
  });

  return claimed.count === 1;
}

/**
 * Records one card actually reaching the screen. This is what the frequency cap
 * is measured from, so it is also what stops a queued-but-unseen ad from being
 * spent. Silent when the ad has gone.
 */
export async function recordAdView(adId: string, bidderId: string) {
  const ad = await prisma.advertisement.findUnique({ where: { id: adId }, select: { id: true } });
  if (!ad) return false;

  const now = new Date();
  // `lastSeenAt` is not an @updatedAt column — the frequency cap reads it, so
  // it is written explicitly on every impression.
  await prisma.$transaction([
    prisma.adImpression.upsert({
      where: { adId_bidderId: { adId, bidderId } },
      create: { adId, bidderId, seenCount: 1, firstSeenAt: now, lastSeenAt: now },
      update: { seenCount: { increment: 1 }, lastSeenAt: now },
    }),
    prisma.advertisement.update({
      where: { id: adId },
      data: { impressions: { increment: 1 } },
    }),
  ]);

  return true;
}

/** Records a tap on the ad's call to action. Silent when the ad has gone. */
export async function recordAdClick(adId: string, bidderId: string) {
  const ad = await prisma.advertisement.findUnique({ where: { id: adId }, select: { id: true } });
  if (!ad) return false;

  const now = new Date();
  await prisma.$transaction([
    prisma.adImpression.upsert({
      where: { adId_bidderId: { adId, bidderId } },
      create: {
        adId,
        bidderId,
        seenCount: 1,
        clickCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        lastClickAt: now,
      },
      update: { clickCount: { increment: 1 }, lastClickAt: now },
    }),
    prisma.advertisement.update({ where: { id: adId }, data: { clicks: { increment: 1 } } }),
  ]);

  return true;
}
