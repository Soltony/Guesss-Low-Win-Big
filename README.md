# GuessLow — Guess Low, Win Big

A **Lowest Unique Bid Auction (LUBA)** platform built to run as a **super-app mini-app**, with a full operations console behind it.

The rule the whole system serves: **the winner is the participant holding the lowest bid amount that nobody else submitted.** The lowest bid does not automatically win — only the lowest *unique* one does.

> Example: `1.00 ×2`, `2.00 ×1`, `3.00 ×2`, `4.00 ×1` → unique amounts are `{2.00, 4.00}` → **2.00 wins**.

---

## Contents

- [Stack](#stack)
- [Getting started](#getting-started)
- [Environment](#environment)
- [How the mini-app authenticates](#how-the-mini-app-authenticates)
  - [Testing without the super app](#testing-without-the-super-app)
- [How bidding and payment work](#how-bidding-and-payment-work)
- [Settlement](#settlement)
- [Re-auctions and carried-forward bids](#re-auctions-and-carried-forward-bids)
- [The scheduled tick](#the-scheduled-tick)
- [Admin console](#admin-console)
- [Image uploads](#image-uploads)
- [Roles and permissions](#roles-and-permissions)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [Going to production](#going-to-production)

---

## Stack

Deliberately identical to the Loan reference project, so both deploy the same way:

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, React 19, TypeScript) |
| Styling | Tailwind CSS + shadcn/ui (Radix primitives), lucide icons |
| Palette | Inherited from Loan: brand yellow `45 93% 47%` on a cool neutral canvas, warm orange `25 100% 45%` for urgency |
| Database | SQL Server via Prisma 5 |
| Sessions | `jose` JWT — short-lived access token + rotating refresh token, DB-backed and revocable |
| Passwords | bcrypt (cost 12) |
| Access control | Edge proxy (`src/proxy.ts`) + per-route permission checks |
| Charts | Recharts |

---

## Getting started

```bash
npm install

cp .env.example .env          # then fill in DATABASE_URL and SESSION_SECRET

npx prisma db push            # create the schema
npm run db:seed               # roles, settings, templates, catalogue, demo auctions

npm run dev                   # http://localhost:9003
```

The seed prints the bootstrap Super Admin credentials. Defaults are
`admin@guesslow.et` / `ChangeMe!2026`, overridable with `SEED_ADMIN_EMAIL`,
`SEED_ADMIN_PASSWORD`, `SEED_ADMIN_PHONE`. The account is created with
`passwordChangeRequired`, so the first sign-in forces a real password.

Set `SEED_DEMO=false` to skip the demo auctions.

| Surface | URL |
| --- | --- |
| Mini-app | `/` |
| Mini-app entry point (super app calls this) | `/connect` |
| Admin console | `/admin` |

Useful scripts:

```bash
npm run typecheck     # tsc --noEmit
npm run build         # prisma generate && next build
npm run db:push       # sync schema without migrations
npm run db:seed       # idempotent seed
```

---

## Environment

See `.env.example` for the annotated list. The ones that matter:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQL Server connection string |
| `SESSION_SECRET` | HS256 signing key for all session tokens — long and random |
| `TOKEN_VALIDATION_API_URL` | Super-app endpoint that resolves a bearer token to `{ phone }` |
| `PAYMENT_URL`, `PAYMENT_KEY`, `ACCOUNT_NO`, `COMPANY_NAME`, `CALLBACK_URL` | Super-app payment gateway credentials for collecting bid fees |
| `PAYMENT_CALLBACK_STRICT` | `true` rejects callbacks whose signature does not verify — see below |
| `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER_ID` | Outbound messaging. Unset ⇒ messages are logged, not sent |
| `CRON_SECRET` | Shared secret for `/api/cron/tick` |
| `ALLOW_TEST_LOGIN` | `true` adds the authorization bypass to `/connect` — see below. Never set in production |

---

## How the mini-app authenticates

The super app is the identity provider. There is no signup form and no password
for customers.

```
Super app  ──►  GET /connect            (Authorization: Bearer <superAppToken>)
                     │
                     ├─► POST /api/auth/connect
                     │        └─► GET TOKEN_VALIDATION_API_URL  →  { phone }
                     │
                     ├─► find-or-create Bidder by phone number
                     └─► set httpOnly `bidderSession` cookie (1 day)
                              └─► redirect to the requested page
```

The token is also carried inside the session cookie, because the payment
gateway needs it to charge that customer's wallet.

Some super-app builds cannot set headers on a webview navigation, so `/connect`
also accepts `?token=…`. The `?next=` parameter is validated to be a same-site
path before redirecting.

Browsing (`/`, `/auctions`, `/auctions/[code]`) is open so the super app can
deep-link into an item. Anything personal or transactional — `/my-bids`,
`/wins`, `/profile`, and every `/api/miniapp/*` route — requires the session.

### Testing without the super app

Set `ALLOW_TEST_LOGIN=true` and `/connect` grows a **Test sign-in** panel: enter
any phone number (or leave it blank for a generated one) and you are in. Add
`?test=1` to force that screen even when a real token is present, so you can
switch identities without clearing the webview.

The bypass is fenced in on every side:

| Guard | Effect |
| --- | --- |
| Env flag | The endpoint returns 403 and the panel does not render unless the flag is on |
| Session stamp | `isTest` lives inside the signed cookie, so it cannot be forged |
| Mini-app banner | An orange bar across the top of every screen states the session is a test |
| Admin banner | The dashboard warns, in the console, that the bypass is live |
| No charging | Test bids skip the payment gateway entirely and record a **zero fee** |
| Labelled data | Test bids are stored with `channel = TEST`, so they are filterable and never inflate revenue |

Everything else still applies: bid range, step grid, per-bidder cap, cooldown,
duplicate-amount rule, and the sealed bid status. A test bidder is a real
bidder that simply pays nothing, so the full flow is exercised honestly.

Clean up afterwards by deleting bids where `channel = 'TEST'`.

---

## How bidding and payment work

Bid fees are collected through the super-app wallet, exactly like loan
repayment in the reference project.

```
POST /api/miniapp/bids   { auctionId, amount }
   │
   ├─ validate: maintenance off, auction LIVE, bidder ACTIVE,
   │            amount within [min,max] and on the step grid,
   │            per-bidder cap, no repeat of your own amount, cooldown
   │
   ├─ create Bid  → status PENDING_PAYMENT        ← does NOT count yet
   │
   └─ POST PAYMENT_URL  { accountNo, amount, callBackURL, companyName,
                          token, transactionId, transactionTime, signature }
                signature = sha256("accountNo=…&amount=…&callBackURL=…&companyName=…
                                    &Key=…&token=…&transactionId=…&transactionTime=…")

… customer approves in their wallet …

POST /api/payment/callback   ← gateway
   ├─ validate the bearer token against TOKEN_VALIDATION_API_URL
   ├─ verify the callback signature
   ├─ match transactionId, check the amount, reject replays
   └─ Bid → ACTIVE, counters incremented, confirmation SMS sent
```

**A bid only counts once its fee is confirmed.** The mini-app polls
`/api/miniapp/bids/[id]/status` while this happens and flips from *confirming
payment* to *bid confirmed* on its own.

Three defences worth knowing about:

- **Idempotency** — gateways retry. `confirmBid` returns early if the bid is
  already `ACTIVE`, so counters can never be double-incremented.
- **Late payments** — if a fee lands after its bid was voided (auction closed
  first), the transaction is marked `REVERSED` and flagged for refund rather
  than silently kept.
- **Timeouts** — bids stuck in `PENDING_PAYMENT` past
  `payments.pendingTimeoutMinutes` are voided by the scheduled tick.

### About `PAYMENT_CALLBACK_STRICT`

The outbound signature format is taken from the reference integration and is
correct. The *callback* signature format has not been confirmed against a live
gateway, so strict rejection defaults to **off**: mismatches are recorded as
`PAYMENT_CALLBACK_SIGNATURE_MISMATCH` audit entries and processing continues.
**Confirm the format against the real gateway in staging, then set
`PAYMENT_CALLBACK_STRICT=true` before going live.**

---

## Settlement

`settleAuction()` in `src/lib/auction-engine.ts` is the whole result:

1. Load every `ACTIVE` bid (unpaid bids are excluded by construction).
2. Group by amount — keyed on the fixed 2-decimal string, so `2` and `2.00` are
   the same amount.
3. Keep amounts held by exactly one bid; sort ascending. Rank 1 wins.
4. Write the `AuctionResult` snapshot (winner + `winners.runnerUpDepth`
   runner-ups), stamp `isUnique`/`rankAtSettlement` on every bid, create the
   `Winner` with a claim deadline, and move the auction to `SETTLED`.

Bid amounts are `Decimal(18,2)`, not floats — float rounding would silently
merge or split amounts and corrupt the uniqueness calculation.

A round has **no valid winner** when no amount is unique, or when it closes
with fewer confirmed bids than `reauctionMinBids` — a turnout floor that stops
a three-bid auction handing over a phone. Either way the item is not awarded,
and the auction is picked up by the re-auction rules below.

Settlement is idempotent, and re-settling (`force`) discards the previous
snapshot and recomputes — for use after a dispute. Both can be routed through
maker-checker. Re-settling never forks a chain that has already produced a
re-auction round.

**Nothing about uniqueness is exposed before settlement.** `isUnique` is null
while an auction runs, and `isRevealAllowed()` gates disclosure according to
`reveal.policy` (`END_ONLY` by default, so bidders cannot probe the bid space).

---

## Re-auctions and carried-forward bids

An auction that closes without a valid winner can be re-run instead of written
off. Each re-run is a real `Auction` row — same item, same rules, code
`195 → 195-R1 → 195-R2` — linked to its predecessor by `parentAuctionId` and to
the root of the chain by `originalAuctionId`, so the whole lineage is one
indexed query. The rules live in `src/lib/reauction.ts`; the pure decision
functions sit in `src/lib/reauction-rules.ts` so the mini-app can render the
same rule the server enforces.

Per auction (set at creation, inherited by every round):

| Field | Meaning |
| --- | --- |
| `reauctionEnabled` | Re-run instead of closing unsold |
| `maxReauctionRounds` | How many re-runs before the chain gives up |
| `reauctionDurationHours` | Length of each re-run |
| `reauctionStartDelayMinutes` | Gap before it opens, so bidders are notified first |
| `reauctionAllowNewBidders` | Whether bidders new to the chain may join |
| `reauctionAllowPreviousBidders` | Whether earlier rounds' bidders may return |
| `reauctionMinBids` | Turnout floor for a valid result |
| `maxTotalBids` | Auction-wide bid cap, alongside `maxBidsPerUser` (0 = unlimited) |

Platform defaults for all of these live under the **Re-Auction** settings
category; `reauction.autoCreate` and `reauction.autoPublish` decide whether the
next round opens by itself and whether it goes live or waits as a draft. With
`autoCreate` off the auction is flagged `PENDING` and an operator opens it from
the auction page.

### Nobody pays twice

**A bidder is never charged twice for the same bid.** When a round opens, every
bid a bidder has already paid for anywhere in the chain becomes a `BidCredit`
they can spend on the new round:

> credits granted on round N+1 = bids paid for across rounds 1..N

Paid 5 bids, then place 8 in the re-auction → 5 are free, 3 are charged. Those
3 join the pool, so a third round grants 8. Across the whole chain a bidder only
ever pays for the largest single round they played.

Two details make that hold:

- Carried bids are recorded with `feeAmount = 0` and `carriedOver = true`, so
  counting fee-bearing bids counts each paid bid exactly once, however deep the
  chain runs.
- A credit is spent by a single conditional `UPDATE … WHERE remaining > 0`, so
  two concurrent bids can never spend the same credit. A bid that later fails
  or expires hands its credit back.

Everyone from the previous round is notified when a round opens
(`AUCTION_REAUCTIONED`, or `REAUCTION_EXCLUDED` when the round is closed to
them): that the auction is being re-run, how many paid bids came with them, and
from which bid a fee starts again. The auction page shows the full chain, and
the carried bids per bidder with how many are still unspent.

---

## The scheduled tick

Point a cron job at this every minute:

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/tick
```

Each tick advances `SCHEDULED → LIVE → ENDED`, voids unpaid bids past their
timeout, auto-settles ended auctions past the grace period, opens re-auction
rounds for the ones with no valid winner, notifies winners and carried-forward
bidders, and sends "ending soon" reminders. Every step is idempotent — a missed
or duplicated tick is harmless.

Lifecycle transitions also happen lazily on read, so the mini-app stays correct
even if the cron job is down.

---

## Admin console

| Module | What it does |
| --- | --- |
| **Dashboard** | Live KPIs, 14-day activity chart, and a "needs attention" queue |
| **Auctions** | Full lifecycle: draft → publish → live → ended → settled/cancelled, plus a provisional-result preview, the re-auction chain with carried-forward bids, and a per-auction bid explorer |
| **Bids** | Every bid across the platform, including unpaid attempts |
| **Winners** | Claim → verify → deliver, forfeiture, and runner-up promotion |
| **Payments** | Reconciliation: manual confirm, fail, and refund/reversal |
| **Items / Categories** | The prize catalogue, bilingual, with image galleries |
| **Images** | Every artwork field takes a device upload (drag-and-drop or file picker) or a pasted URL |
| **Content** | Home banners and versioned terms & conditions |
| **Bidders** | Customer accounts, activity, and suspend/block moderation |
| **Notifications** | Editable EN/AM message templates and the delivery log |
| **Approvals** | Maker-checker queue with a field-level diff |
| **Reports** | Fee income vs prize cost per auction, category breakdown, CSV export |
| **Audit Logs** | Every privileged action, filterable, CSV export |
| **Users / Access Control** | Accounts, one-time passwords, and the role permission matrix |
| **Settings** | ~40 platform settings, grouped and self-describing |

Guardrails built into the console:

- Auction economics lock as soon as a bid is placed — changing the fee or bid
  range mid-auction would retroactively invalidate bids people paid for.
- Auctions that have been public are cancelled, never deleted.
- Items still referenced by an auction are deactivated instead of deleted.
- The last active Super Admin cannot be demoted, disabled, or deleted.
- Nobody can approve their own maker-checker request.

---

## Image uploads

Item photos, category artwork and home banners all accept a file from the
device — drag it onto the drop zone or use the picker — with "use a URL
instead" still there for artwork already on a CDN.

`POST /api/admin/uploads` takes the file and returns `{ url }`. It:

- requires an admin session with create or update on items, categories or content;
- caps uploads at **5 MB**;
- identifies the format by **magic number**, not the declared MIME type or the
  file extension, and accepts only PNG, JPEG, WebP, GIF and AVIF — **SVG is
  refused**, because it can carry script and would run from our own origin;
- generates the stored filename itself, so path traversal and overwrites are
  impossible;
- writes to `public/uploads/` and records the upload in the audit log.

`public/uploads/` is git-ignored. On a platform with an ephemeral filesystem
(most serverless hosts) that folder does not survive a deploy — mount a volume,
or swap the `writeFile` call in the route for an object-store client. Nothing
else has to change, because the rest of the app only ever sees the returned URL.

---

## Roles and permissions

A role is a matrix of `{ read, create, update, delete, approve }` per module.
The module list *is* the route registry (`src/lib/route-permissions.ts`), so
adding a page automatically makes it assignable.

Enforcement happens twice, deliberately:

1. **`src/proxy.ts`** — before the page renders, asks
   `/api/admin/auth/session` (permissions always read fresh from the database,
   so revoking a role takes effect immediately) and checks module `read`.
2. **`requirePermission(module, action)`** — inside every mutating route,
   because the proxy cannot tell a create from a delete.

Seeded roles: **Super Admin** (bypasses all checks), **Auction Manager**,
**Approver**, **Finance**, **Support**, **Auditor**.

`approve` is the second-pair-of-eyes right: settling auctions, deciding pending
changes, and manually confirming payments.

---

## Configuration

Everything tunable lives in **Settings**, backed by `src/lib/settings.ts`. The
page renders itself from the definitions, so adding a setting is one object.

Groups: **Platform**, **Bidding Rules**, **Bid Visibility**, **Winners & Claims**,
**Re-Auction**, **Payments**, **Notifications**, **Security & Governance**.

Highlights:

- `bidding.*` — default fee, bid range, increment, per-bidder cap, auction-wide
  cap, duration, auto-extend (anti-sniping), "ending soon" threshold
- `reveal.policy` — `END_ONLY` (default), `LAST_WINDOW`, or `LIVE`
- `winners.*` — auto-settle, grace period, claim window, runner-up depth
- `reauction.*` — whether rounds open and publish automatically, and the
  defaults for round limit, duration, start delay, who may take part, and the
  turnout floor
- `payments.*` — enable/disable fees, merchant details, timeout, refund flagging
- `security.*` — login lockout, and maker-checker toggles for publishing,
  settings, and settlement

Settings marked **sensitive** route through maker-checker when
`security.requireApprovalForSettings` is on. Auction-level values always
override the platform default — settings only supply the starting point.

---

## Project layout

```
prisma/
  schema.prisma          # SQL Server schema (no Prisma enums — status columns are strings)
  seed.ts                # idempotent seed

src/
  proxy.ts               # Edge access control + CSP (Next 16's middleware)

  lib/
    auction-engine.ts    # ranking, settlement, lifecycle, reveal policy
    reauction-rules.ts   # pure re-auction rules (no DB — shared with the mini-app)
    reauction.ts         # re-auction rounds, carried-forward bid credits, lineage
    bidding.ts           # bid validation, caps, placement, confirmation
    payment-gateway.ts   # super-app payment: signing, initiation, verification
    miniapp-connect.ts   # super-app token → bidder session
    session.ts           # admin + bidder sessions
    jwt.ts               # Edge-safe token helpers
    permissions.ts       # permission matrix helpers
    route-permissions.ts # route ↔ module registry (Edge-safe, icon-free)
    menu-items.ts        # the same registry, decorated with icons
    approvals.ts         # maker-checker
    settings.ts          # configuration registry
    notifications.ts     # templates and transport
    audit-log.ts         # audit writes with credential redaction
    i18n.ts              # EN/AM copy
    miniapp-data.ts      # scrubbed read models for the mini-app
    format.ts            # Decimal → number, money, phone masking, countdown

  app/
    page.tsx  connect/  auctions/  my-bids/  wins/  profile/    # mini-app
    admin/                                                      # console
    api/
      auth/connect            # super-app session exchange
      miniapp/*               # bidder-facing APIs
      payment/callback        # gateway callback
      cron/tick               # scheduled maintenance
      admin/*                 # console APIs

  components/
    miniapp/    admin/    ui/    icons.tsx
```

**Type unions, not Prisma enums.** The SQL Server connector does not support
Prisma enums, so status columns are strings and `src/lib/types.ts` holds the
allowed values.

---

## Going to production

Before launch:

1. Replace `SESSION_SECRET` with a long random value; never reuse the example.
2. **Unset `ALLOW_TEST_LOGIN`.** With it on, anyone who can reach `/connect`
   can sign in as any phone number.
3. Confirm the payment callback signature format, then set
   `PAYMENT_CALLBACK_STRICT=true`.
4. Set `ALLOWED_ORIGIN` to the real mini-app origin.
5. Sign in as the seeded Super Admin, change the password, create real
   accounts, and disable the seed account.
6. Schedule `/api/cron/tick` every minute with a strong `CRON_SECRET`.
7. Configure the SMS provider — until `SMS_API_URL` is set, messages are only
   logged.
8. Use `prisma migrate` rather than `db push` once schema history matters.
9. Review `frame-ancestors` in `src/proxy.ts`. It is currently `*` so the super
   app can embed the mini-app in a webview; tighten it to the super-app origin
   if that origin is fixed.

Operationally: bid economics deserve a dry run. In the auction form, the
**Sanity check** panel shows how many distinct amounts the bid range allows and
the break-even bid count. A narrow range with many bidders produces duplicates
everywhere and auctions that end with no winner at all.
