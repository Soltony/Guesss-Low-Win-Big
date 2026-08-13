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

  const pad = (n: number) => String(n).padStart(2, '0');
  const urgent = mounted && c.total < 60 * 60 * 1000;

  // Server and client clocks differ, so the real value can only be rendered
  // after mount. The placeholder mirrors the final shape exactly, so nothing
  // shifts when the timer takes over.
  if (!mounted) {
    if (variant === 'blocks') {
      return (
        <div className={cn('flex gap-1.5', className)} aria-hidden>
          {['days', 'hrs', 'min', 'sec'].map((label) => (
            <div key={label} className="gl-digit">
              <span className="text-xl font-bold leading-none tabular-nums text-white/35">--</span>
              <span className="mt-1 text-[9px] uppercase tracking-wider text-white/35">
                {label}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return (
      <span className={cn('tabular-nums text-muted-foreground', className)} aria-hidden>
        --:--:--
      </span>
    );
  }

  if (c.ended) {
    return <span className={cn('font-medium text-muted-foreground', className)}>Ended</span>;
  }

  if (variant === 'blocks') {
    const parts = [
      { value: c.days, label: 'days' },
      { value: c.hours, label: 'hrs' },
      { value: c.minutes, label: 'min' },
      { value: c.seconds, label: 'sec' },
    ];

    return (
      <div className={cn('flex gap-1.5', className)}>
        {parts.map((part) => (
          <div key={part.label} className="gl-digit">
            <span
              className={cn(
                'text-xl font-bold leading-none tabular-nums',
                urgent && 'text-accent'
              )}
            >
              {pad(part.value)}
            </span>
            <span className="mt-1 text-[9px] uppercase tracking-wider text-white/55">
              {part.label}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const text = `${c.days > 0 ? `${c.days}d ` : ''}${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}`;

  if (variant === 'pill') {
    return (
      <span className={cn('gl-pill tabular-nums', urgent && 'border-accent/50 text-accent', className)}>
        {text}
      </span>
    );
  }

  return (
    <span className={cn('tabular-nums', urgent ? 'text-accent' : 'text-foreground', className)}>
      {text}
    </span>
  );
}
