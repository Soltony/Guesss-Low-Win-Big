'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { countdownFrom } from '@/lib/format';

/**
 * Live countdown. Renders the server-computed value first so there is no
 * hydration mismatch, then ticks locally every second.
 */
export function Countdown({
  endAt,
  className,
  onEnd,
  compact = false,
}: {
  endAt: string;
  className?: string;
  onEnd?: () => void;
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => new Date(endAt).getTime());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [endAt]);

  const c = countdownFrom(endAt, mounted ? now : new Date(endAt).getTime());

  useEffect(() => {
    if (mounted && c.ended) onEnd?.();
  }, [mounted, c.ended, onEnd]);

  if (!mounted) {
    return <span className={cn('tabular-nums', className)}>—</span>;
  }

  if (c.ended) {
    return <span className={cn('font-semibold text-muted-foreground', className)}>Ended</span>;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const urgent = c.total < 60 * 60 * 1000;

  if (compact) {
    return (
      <span className={cn('tabular-nums font-semibold', urgent && 'text-destructive', className)}>
        {c.days > 0 ? `${c.days}d ` : ''}
        {pad(c.hours)}:{pad(c.minutes)}:{pad(c.seconds)}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'tabular-nums font-semibold tracking-tight',
        urgent ? 'text-destructive' : 'text-destructive/80',
        className
      )}
    >
      {c.days}d : {pad(c.hours)}h : {pad(c.minutes)}m : {pad(c.seconds)}s
    </span>
  );
}
