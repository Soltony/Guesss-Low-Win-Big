import prisma from './prisma';
import { getSettings } from './settings';
import { AD_FREQUENCIES, AD_PLACEMENTS } from './types';
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
  ctaLabel: string | null;
  ctaLabelAm: string | null;
  linkUrl: string | null;
  autoCloseSeconds: number;
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
 * Ads due for one bidder, already trimmed to the per-visit cap. Serving them
 * counts as showing them, so the impression is recorded here rather than
 * trusting the client to report back — a closed webview must not hand a bidder
 * the same popup on every visit.
 */
export async function popupAdsForBidder(bidder: {
  bidderId: string;
  isTest?: boolean;
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

  await recordImpressions(
    due.map((ad) => ad.id),
    bidder.bidderId
  );

  return {
    delaySeconds,
    ads: due.map((ad) => ({
      id: ad.id,
      title: ad.title,
      titleAm: ad.titleAm,
      body: ad.body,
      bodyAm: ad.bodyAm,
      imageUrl: ad.imageUrl,
      ctaLabel: ad.ctaLabel,
      ctaLabelAm: ad.ctaLabelAm,
      linkUrl: ad.linkUrl,
      autoCloseSeconds: ad.autoCloseSeconds,
    })),
  };
}

async function recordImpressions(adIds: string[], bidderId: string) {
  const now = new Date();

  for (const adId of adIds) {
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
  }
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
