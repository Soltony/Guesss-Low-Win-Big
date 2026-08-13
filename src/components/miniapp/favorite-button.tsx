'use client';

import { useState, useTransition } from 'react';
import { Bookmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export function FavoriteButton({
  auctionId,
  initial = false,
  onDark = false,
}: {
  auctionId: string;
  initial?: boolean;
  /** Sitting on an ink surface, so the resting colour has to invert. */
  onDark?: boolean;
}) {
  const [favorited, setFavorited] = useState(initial);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const toggle = () => {
    // Optimistic: the watchlist is cosmetic, so a failure just rolls back.
    const next = !favorited;
    setFavorited(next);

    startTransition(async () => {
      try {
        const response = await fetch('/api/miniapp/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auctionId }),
        });
        if (!response.ok) {
          setFavorited(!next);
          if (response.status === 401) {
            toast({
              title: 'Open from the super app',
              description: 'Reconnect to save auctions to your watchlist.',
            });
          }
        }
      } catch {
        setFavorited(!next);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={favorited}
      aria-label={favorited ? 'Remove from watchlist' : 'Save to watchlist'}
      className={cn(
        'flex items-center justify-center transition-colors disabled:opacity-50',
        onDark ? 'text-white/70 hover:text-white' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Bookmark
        className={cn('h-4 w-4', favorited && 'fill-primary text-primary')}
        strokeWidth={2}
      />
    </button>
  );
}
