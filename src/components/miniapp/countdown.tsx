'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { countdownFrom } from '@/lib/format';

/**
 * Live countdown. Renders a placeholder on the server so hydration cannot
 * mismatch, then ticks locally once mounted.
 */
export function Countdown({
  endAt,
  className,
  onEnd,
  variant = 'inline',
}: {
  endAt: string;
  className?: string;
  onEnd?: () => void;
  variant?: 'inline' | 'pill' | 'blocks';
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
    return <span className={cn('tabular-nums text-muted-foreground', className)}>··:··:··</span>;
  }

  if (c.ended) {
    return <span className={cn('font-medium text-muted-foreground', className)}>Ended</span>;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const urgent = c.total < 60 * 60 * 1000;

  if (variant === 'blocks') {
    const parts = [
      { value: c.days, label: 'days' },
      { value: c.hours, label: 'hrs' },
      { value: c.minutes, label: 'min' },
      { value: c.seconds, label: 'sec' },
    ];
    return (
      <div className={cn('flex gap-2', className)}>
        {parts.map((part) => (
          <div
            key={part.label}
            className={cn(
              'min-w-[52px] rounded-md border px-2 py-1.5 text-center',
              urgent ? 'border-accent/40 bg-accent/5' : 'border-border bg-card'
            )}
          >
            <p
              className={cn(
                'text-lg font-semibold tabular-nums leading-none',
                urgent && 'text-accent'
              )}
            >
              {pad(part.value)}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {part.label}
            </p>
          </div>
        ))}
      </div>
    );
  }

  const text = `${c.days > 0 ? `${c.days}d ` : ''}${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}`;

  if (variant === 'pill') {
    return (
      <span
        className={cn(
          'gl-pill tabular-nums',
          urgent && 'border-accent/40 text-accent',
          className
        )}
      >
        {text}
      </span>
    );
  }

  return (
    <span className={cn('font-medium tabular-nums', urgent && 'text-accent', className)}>
      {text}
    </span>
  );
}
