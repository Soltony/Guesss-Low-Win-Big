# Security review — GuessLow

Covers all 110 rows of `SecurityFindings.xlsx` plus an independent review of the
application, and records what was changed.

**Verification:** `npx tsc --noEmit` clean · `npx vitest run` 166 passing (109 pre-existing
plus 57 new) · `npx next build` succeeds · behaviour confirmed against a running server (see
[Runtime verification](#runtime-verification)).

> **Note on the spreadsheet's own status columns.** Most rows are marked
> `Applicable=Yes / Fixed=Yes / Status=Resolved`, and the "Security Issue" column
> repeats row 3's text for all 110 rows. Neither reflected the code: SEC-092 through
> SEC-107 were all still present and exploitable when this review started. The
> verdicts below come from reading the code, not from the tracker.

---

## 1. What was actually wrong

Six issues stood out as the ones that mattered.

### The session signing key could be empty (SEC-092, Critical)

`src/lib/jwt.ts` read `process.env.SESSION_SECRET || ''`. With the variable unset,
every admin and bidder JWT was signed with an empty HMAC key — a key anybody can
reproduce, because it is the absence of one. Any party could mint a valid Super
Admin session token, and the application would look perfectly healthy while doing it.

The key is now resolved through `requireSecret()` (`src/lib/secrets.ts`), which fails
closed: an unset value, the `.env.example` placeholder, or anything under 32 characters
throws instead of degrading. Resolution is lazy and cached, so it happens at first use
rather than at import, where in some runtimes it would run before the environment loads.

### Security-relevant randomness came from `Math.random()` (SEC-093, High)

`uuid()` fell back to `Math.random()` for session identifiers, and
`generateTempPassword()` used it for every character of an admin's initial
credential. `Math.random()` is a non-cryptographic PRNG: its internal state can be
reconstructed from a handful of observed outputs, after which the whole stream —
past and future — is known.

`src/lib/random.ts` now provides CSPRNG helpers built on Web Crypto, with bounded
integers drawn by rejection sampling so no modulo bias narrows the alphabet. All
security-relevant draws go through it.

### No CSRF defence beyond a cookie attribute (SEC-094, Medium)

There was no server-side origin validation anywhere. Session cookies were
`SameSite=Lax`, a single browser-side control — one non-conforming webview, or one
regression in that attribute, and cross-site request forgery against authenticated
admin endpoints was open again.

`src/proxy.ts` now runs a same-origin check on every `POST`/`PUT`/`PATCH`/`DELETE`
ahead of routing, so no handler can be added without it. Only `/api/payment/callback`
and `/api/cron/*` are exempt — they are machine-to-machine, have no browser origin to
present, and carry their own authentication.

### Sessions never expired (SEC-095, High)

Neither an idle timeout nor an absolute lifetime existed, and refresh-token rotation
extended `expiresAt` on every refresh. An active session — including one being driven
by a stolen token — stayed valid indefinitely.

`src/lib/session.ts` now enforces both, configurable and clamped
(`SESSION_IDLE_MINUTES` 5–240, default 30; `SESSION_ABSOLUTE_HOURS` 1–72, default 8).
Rotation renews the token but caps its expiry at sign-in plus the absolute lifetime.

### The admin console could be framed by anyone (SEC-096, Medium)

The CSP declared `frame-ancestors *` and no `X-Frame-Options` was set. A clickjacked
interaction over this console can approve a payout or settle an auction.

Now `frame-ancestors 'none'` with `X-Frame-Options: DENY`, overridable through
`FRAME_ANCESTORS` for a deliberately embedded surface.

### Public pages shipped with no CSP at all (SEC-097, Medium)

The middleware matcher enumerated protected routes individually, so `/connect`,
`/auctions` and `/auctions/[code]` — the pages that render operator-supplied auction
content, and the least covered on the site — received no Content-Security-Policy.

The matcher now matches everything except immutable build output, so a route added
later is covered the day it is written rather than silently shipping bare.

---

## 2. Everything else that was fixed

| ID | Issue | Fix |
|---|---|---|
| SEC-098, 074 | `handle()` returned the raw exception message | Generic message plus a correlation reference in production; full detail logged server-side. Verbose in development, `ApiError` passes through unchanged |
| SEC-099, 045, 091 | No rate limiting anywhere | `src/lib/rate-limit.ts` — fixed windows on sign-in, session exchange, password change, bid placement, payment callback, cron tick. Authenticated limits key on the account, unauthenticated on the address. A successful sign-in clears the window |
| SEC-100 | Secrets compared with `!==` | `secretsMatch()` hashes both operands to a fixed width and compares in constant time. Applied to the cron secret and the callback signature |
| SEC-101, 084 | `ALLOWED_ORIGIN` unvalidated alongside `Allow-Credentials: true`; no `Vary` | Wildcard and non-https origins now fail the build; `Vary: Origin` emitted |
| SEC-102, 085, 076 | COOP/CORP/`X-Permitted-Cross-Domain-Policies` absent; `Permissions-Policy` named 3 features | All three set; the policy now names 31 features — it denies only what it names, so anything omitted stays available to injected script |
| SEC-103, 073, 034, 082 | Admin cookies `SameSite=Lax`; `Secure` only when `NODE_ENV=production` | Admin cookies are `SameSite=Strict`; `Secure` is now the default and only a local run opts out. The bidder cookie stays `Lax` — the super app enters the webview by cross-site navigation and Strict would break every deep link. See [Accepted](#4-accepted-risks) |
| SEC-104, 031, 065 | Policy accepted `Password1!`, `Admin@1234` | Minimum raised to 12; common passwords, four-character runs and keyboard/alphabet sequences rejected. Generated temporary credentials are validated against the same policy and resampled — never patched — if they fail |
| SEC-105 | No cache directives on API responses | `Cache-Control: no-store, no-cache, must-revalidate, private` on every API response, plus `Pragma`/`Expires` |
| SEC-106 | `X-Forwarded-For` trusted unconditionally | Honoured only when `TRUST_PROXY=true`. Otherwise all callers share one key: a global ceiling rather than no limit at all, and no caller-chosen address in the audit trail |
| SEC-107 | Placeholder secrets could reach a deployment | Rejected at runtime by `requireSecret()`. The live `.env` already carries real values |
| SEC-108 | `PAYMENT_CALLBACK_STRICT` defaulted to off, so a mismatched signature was logged and then processed | Unset now means strict in production. `false` still works but logs a warning on every use — see [Needs a decision](#5-needs-your-decision) |
| SEC-052, 078, 042 | `img-src` allowed all of `https:` | Narrowed to the three hosts in `next.config.ts` |
| SEC-009, 036, 048 | `prisma/seed.ts` fell back to the literal `ChangeMe!2026` | No literal fallback. A supplied `SEED_ADMIN_PASSWORD` is held to the live policy; otherwise one is generated and printed once |
| SEC-005, 015, 050, 072, 080, 081 | RBAC | Already layered (proxy + per-route `requirePermission` + page-level checks). One real gap closed — see [Found independently](#3-found-independently) |
| SEC-010, 057 | Security event logging | Audit logging was already broad. Added `LOGIN_RATE_LIMITED`, session-revocation reasons, and the token-validation failure detail |
| SEC-043, 087 | `X-Powered-By` | `poweredByHeader: false` was already set; the header is now also explicitly cleared and the ASP.NET variants deleted |

---

## 3. Found independently

Not in the spreadsheet.

**Vertical privilege escalation through the admin APIs.** `src/proxy.ts` computed
the `roles` constraint only for page routes — `path.startsWith('/api/')` short-circuited
it to `undefined`. So `/admin/users` was Super-Admin-only while `/api/admin/users`
behind it accepted any role holding the `users` module grant. Same for
`/api/admin/roles` and the audit-log export. `API_ROLE_CONSTRAINTS` in
`src/lib/route-permissions.ts` now derives the constraint from the same route
registry and the proxy enforces it on both. Verified: a non-Super-Admin holding
*every* module permission now gets 403 on those three and 200 on everything it
legitimately holds.

**Unmapped admin APIs fell open.** An `/api/admin/*` path with no entry in
`API_MODULE_MAP` hit `return passthrough()` — so every new endpoint shipped unguarded
until somebody remembered to map it. Now denied by default, with `/api/admin/uploads`
named in `SELF_GUARDED_ADMIN_API` because its permission is the union of three module
grants, which one key cannot express, and its handler asks the question directly.

**A callback reporting a paid amount of zero confirmed the bid.** In
`src/app/api/payment/callback/route.ts` the verdict was
`gatewaySaysPaid && (paidAmount === 0 || amountMatches)`, conflating "the gateway sent
no amount" with "the gateway said nought". A zero is now rejected against a non-zero
expected fee; a genuinely absent field still falls back to the reported status, which
the signature attests.

**Session cookies were printed into the debug log.** `SECRET_KEYS` in
`src/lib/superapp-debug.ts` did not include `cookie`, so `headerMap()` wrote whole
admin and bidder sessions verbatim into any log the wire tracer touched. Added
`cookie`, `set-cookie`, `x-cron-secret`, `biddersession`, `signature` and the password
fields.

**Debug mode could be switched on in production.** `superAppDebugEnabled()` honoured
`SUPERAPP_DEBUG=true` anywhere. The same switch decides whether the gateway's own error
text travels back to the webview in an API response, making a stray flag an information
disclosure channel. Both it and `superAppSecretsShown()` are now hard-off in production.

**Gateway configuration detail reached the bidder's phone.** A `PaymentError` from
`resolveGatewayConfig()` — `missing: CALLBACK_URL, PAYMENT_KEY` — became a
`BidRejected` message returned to the client. 5xx-class gateway errors now return a
generic sentence and log the detail; 4xx declines still reach the bidder, who needs to
read them.

**Token-validation failures echoed internal detail.** The payment callback returned
`error.message` for *any* throw, including a failed `fetch` naming the internal
token-validation host, to a caller who had just failed authentication. Narrowed to
`PaymentError` only.

**A test-issued bidder session outlived the bypass.** `getBidderSession()` accepted a
cookie stamped `isTest` regardless of whether `ALLOW_TEST_LOGIN` was still on, so a
session minted during testing kept working after the bypass was switched off. Now
refused unless the bypass is enabled.

**No request body ceiling.** JSON handlers buffered whatever arrived. `readJsonBody()`
caps at 256 KB, checking `Content-Length` before reading, and is applied across every
body-reading route.

---

## 4. Accepted risks

**`style-src 'unsafe-inline'` (SEC-109).** Required by the Tailwind and Radix layer,
which writes inline style attributes the server cannot nonce. The exposure is style
injection, not script execution — `script-src` is nonce-pinned with `strict-dynamic`
and no `unsafe-inline`. Removing it needs a UI-layer refactor.

**The bidder cookie is `SameSite=Lax`.** The super app enters the webview by navigating
to `/connect`, a cross-site top-level navigation. Under `Strict` the cookie would be
withheld on exactly that hop and every deep link would bounce through a fresh token
exchange. It is HttpOnly and Secure, carries no privileged capability, and the
server-side origin check covers the state-changing requests SameSite would otherwise
guard alone. Admin cookies, which have no such entry path, are `Strict`.

**`uuid` 8.3.2 via `exceljs` (SEC-110).** Not exploitable — `exceljs` calls `uuid.v4()`
with no `buf` argument, so the affected path is never reached. The only remediation npm
offers is a semver-major downgrade to `exceljs` 3.4.0. `npm audit` reports nothing else.

**Rate-limit counters are per-process.** Exact on a single instance; on *n* instances
the effective ceiling is *n* times the configured limit. The upgrade path is a shared
store (Redis). A limit loose by a known factor is still the difference between thousands
of attempts a minute and a handful.

**`Math.random()` in `src/components/ui/sidebar.tsx:656`.** Picks a skeleton
placeholder's width. Cosmetic, not security-relevant — noted so it is not re-flagged.

---

## 5. Needs your decision

**`PAYMENT_CALLBACK_STRICT` (SEC-108).** The default is now strict in production, which
is the safe direction but changes live behaviour: if the gateway's signature format
differs from what `verifyCallbackSignature` computes, callbacks will be **rejected**
rather than accepted with a logged mismatch, and bids will not confirm. Confirm the
format against the gateway before the next production deploy. To defer, set
`PAYMENT_CALLBACK_STRICT="false"` explicitly — it still works, and logs a warning each
time it is used.

---

## 6. Not applicable

Findings belonging to other products in the tracker, or to a stack this app does not use.

| IDs | Why |
|---|---|
| SEC-001, 004, 023, 029, 030, 011 | Memo Automation System — memo IDs, email-change verification, password hashes in responses. No analogue here; this app returns no password material in any response |
| SEC-054, 056, 059 | Hospital tenancy and appointment endpoints — different product |
| SEC-064 | Registration/login identifier mismatch — admins sign in by email, bidders by super-app identity |
| SEC-006, 008, 046, 079 | `fast-xml-parser`, `tar`, `axios`, `jsPDF` — none are dependencies |
| SEC-007, 062 | Vulnerable Next.js — already on 16.3.0, past the advisory range. `remotePatterns` is restricted to three hosts |
| SEC-039, 040 | Nodemailer TLS — no mailer; notifications go over an SMS API |
| SEC-051, 055, 077, 086 | IIS / ASP.NET version headers and the default welcome page — not this stack |
| SEC-090 | Hard-coded .NET `JwtSettings.Secret`. The analogue is SEC-092, fixed |
| SEC-089 | `connectionId` from `Math.random()` — no such identifier exists here |
| SEC-083 | Persistent tracking identifiers (`_device_id`, `MSFPC`) — not set by this app |
| SEC-047 | Tokens in `localStorage` — confirmed absent; only a language preference is stored |
| SEC-019, 020, 021 | Upload/download authorization and file-type allowlist — already satisfied: magic-number sniffing, generated UUID filenames, 5 MB cap, SVG excluded, traversal-proof serving |
| SEC-016, 025, 067, 069, 070, 071 | Session binding and revocation — already DB-backed with JTI binding, refresh-cookie matching, one active session per user, and revocation on logout, password change and deactivation. The gaps that did exist were lifetime (SEC-095) and cookie scope (SEC-103), both fixed |
| SEC-022, 026, 028, 033, 058, 060, 061 | Delegation expiry, maker–checker, activation-token lifetime, forced first-login change — either no analogue, or already implemented (`passwordChangeRequired` is set on every created and reset account and pinned by the proxy) |
| SEC-037 | Input validation — Zod plus explicit per-field validation is already in place |
| SEC-038 | Timestamp-derived account numbers — no such identifier |
| SEC-044 | Authentication error detail — the login already returns one generic message for both unknown email and wrong password |
| SEC-075 | Sensitive data in logs — audit details were already redacted; the log-header gap is in [Found independently](#3-found-independently) |

---

## 7. Deployment (outside the codebase)

These cannot be fixed in application code.

- **SEC-053, 088 — TLS ciphers.** Disable all TLS 1.2 CBC-mode and static-RSA suites at
  the terminator; allow only forward-secret AEAD (`ECDHE_*_GCM`, `CHACHA20_POLY1305`)
  and prioritise TLS 1.3.
- **SEC-027 — slow-request exhaustion.** Put a reverse proxy or WAF in front to buffer
  requests, with connection timeouts and minimum transfer rates. The application-level
  rate limits are a complement, not a substitute.
- **SEC-035, 077 — `Server` header.** Emitted by the runtime and the proxy, not by
  Next.js. Suppress or genericise it at the edge.
- **`TRUST_PROXY`.** Set to `true` only once a proxy you control overwrites
  `X-Forwarded-For`. Until then per-address rate limits collapse to one global bucket,
  and audit rows carry no client address.
- **Rotate `SESSION_SECRET` and `CRON_SECRET`** if either was ever deployed holding a
  placeholder, and treat existing sessions as compromised.

---

## Runtime verification

Confirmed against a running server, not just by reading the diff.

| Check | Result |
|---|---|
| Security headers on `/admin/login`, `/connect`, `/auctions`, API routes | CSP, HSTS, `X-Frame-Options: DENY`, COOP, CORP, `X-Permitted-Cross-Domain-Policies`, 31-feature `Permissions-Policy` all present |
| `Cache-Control` on API responses | `no-store, no-cache, must-revalidate, private` |
| Cross-origin `POST` | 403 · same-origin 401 (reaches handler) · no Origin, non-browser client, reaches handler |
| Login rate limit | attempts 1–8 → 401, 9–12 → 429 with `Retry-After: 299` |
| Cron secret | absent 403 · wrong 403 · correct 200 |
| Cookie attributes | `HttpOnly; SameSite=strict` on both admin cookies; refresh expiry capped at 8h, not 7 days |
| Idle timeout | session aged to 90 min idle → 401 |
| Absolute lifetime | session created 20 h ago, active a moment ago → 401 |
| Logout | revoked server-side; replaying pre-logout cookies → 401 |
| Non-Super-Admin with every module grant | `/api/admin/users`, `/api/admin/roles`, audit-log export → 403; auctions, items, categories, settings → 200 |
| Password policy | common, short, sequence, run and missing-class candidates all rejected; a strong one accepted, and the change revoked every session |
| Full admin flow | sign in → session → admin API → admin page, all 200 |
| Full mini-app flow | test sign-in → profile, wins, favourites, bids → bid placed and read back; terms guard and CSRF still enforced |

Probe accounts, the probe role and the probe bidders were removed afterwards.

---

## 8. Follow-up review

Raised after the review above, in *Additional guess low findings*.

### The temporary password was shown to the administrator (CWE-522, Medium)

Creating an admin account, or resetting one, returned the generated one-time
password in the API response and rendered it in a dialog for the operator to copy
and pass on by hand. That put a live credential in front of a second party and left
its delivery to whatever channel that person happened to use.

The credential now goes only to the account holder. `deliverTempPassword()`
(`src/lib/temp-password.ts`) sends it by SMS to the account's own number and the
routes return nothing but whether it arrived:

```
{ passwordDelivery: { delivered: true, recipient: "2519****44" } }
```

Deliberate details:

- **It bypasses the template pipeline.** `notify()` writes every message body to
  `NotificationLog`, readable by anyone holding `notifications.logs`. The transport
  was split out into `src/lib/sms.ts` so a credential can be sent without being
  stored — no template row, no log row.
- **It ignores `notifications.enabled`.** That switch governs bidder messaging.
  Silencing auction SMS should not make colleagues’ accounts unreachable.
- **A missing provider is a failure, not a success.** `notify()` prints and returns
  ok when `SMS_API_URL` is unset; `sendSms()` reports the failure, so the caller
  knows the message did not go out.
- **The failure reason never leaves the server.** The operator is told the SMS did
  not go out and nothing more; why it failed goes to the server log and the audit
  row. Even there the password is stripped from the provider’s error text first — a
  provider that echoes the failed request back would otherwise reintroduce the exact
  disclosure being fixed.
- **The audit row records delivery, not the credential:** `passwordDelivered` and a
  redacted `deliveryError`.

**Retry.** The failure dialog offers a retry. There is nothing stored to resend — the
password exists as a hash from the moment it is issued — so a retry runs the
password-reset path: it mints a fresh one-time password, sends that, and invalidates
whatever the failed attempt generated. The button is shown only to operators holding
`users.update`, since that is the endpoint it calls.

**Terminal fallback.** If the send fails, the password is printed to the server log
with the reason and the recipient. This is a deliberate exception to "never log a
temporary password": the alternative is an account nobody can sign into, recoverable
only by a retry that may fail identically. It is reachable only by someone with server
access, it is labelled as a fallback, and it tells whoever reads it to reset the
account once SMS is restored. With no `SMS_API_URL` configured every issuance takes
this path, which is why `.env.example` now says to configure the provider before going
live.

Covered by `src/lib/temp-password.test.ts`: the message carries the password, the
fallback prints it, a thrown transport is treated as a failed send rather than
rolling back a created account, and the password never survives in a returned error.

### The phone number had no length or format rule (CWE-20, Low)

User creation and editing accepted `phoneNumber.length < 9` as the whole rule — a
floor with no ceiling, applied after `normalizePhone()` had already stripped every
non-digit. Two consequences: a number with digits pasted onto the end was stored as
something that can never be dialled, and an entry like `251900000001sdfghjk` was
quietly repaired into a well-formed number rather than refused.

The rule now lives in one place, `parseEthiopianMobile()` (`src/lib/format.ts`),
which returns the storable number or null:

- **The entry is judged before it is cleaned up.** `looksLikePhoneNumber()` rejects
  anything carrying letters first, because normalization is what hid the mistake.
- **Exactly nine digits behind the 251 country code** — `isValidEthiopianPhone()`,
  the rule the bidder import (`isValidParticipantPhone`) already applied, promoted
  out of `eligibility-list.ts` so both use one definition.
- **Mobile ranges only** (09 Ethio Telecom, 07 Safaricom). An admin account is
  reachable only by the SMS carrying its one-time password, so a landline is an
  account nobody can ever sign into.

The message names the `phoneNumber` field, so it appears under the input. The input
itself is `type="tel"` with `maxLength={13}` — room for `+251912345678` and not a
character more, so the over-length case cannot be typed at all.

Covered by `src/lib/format.test.ts`, including the reported entry and the
normalization step that used to swallow it.
