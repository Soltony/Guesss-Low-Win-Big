import { describe, expect, it } from 'vitest';
import { claimDeadlineFrom } from './claim-window';

describe('claimDeadlineFrom', () => {
  const settled = new Date('2026-09-28T00:10:01.000Z');

  it('adds the window in hours to when the winner was recorded', () => {
    expect(claimDeadlineFrom(settled, 72).toISOString()).toBe('2026-10-01T00:10:01.000Z');
  });

  it('measures a widened window from the same start, not from the change', () => {
    // A winner settled under 72h whose window is later raised to 710h keeps
    // their settlement time as the start, so the new deadline is 710h after it.
    expect(claimDeadlineFrom(settled, 710).toISOString()).toBe('2026-10-27T14:10:01.000Z');
  });

  it('can land in the past when the window is narrowed', () => {
    expect(claimDeadlineFrom(settled, 1).getTime()).toBeLessThan(
      new Date('2026-10-01T00:00:00.000Z').getTime()
    );
  });
});
