'use client';

import { useState, useTransition } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export function FavoriteButton({
  auctionId,
  initial = false,
}: {
  auctionId: string;
  initial?: boolean;
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
      aria-label={favorited ? 'Remove from watchlist' : 'Add to watchlist'}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-md ring-1 ring-border transition hover:scale-105 disabled:opacity-60"
    >
      <Star
        className={cn(
          'h-5 w-5 transition-colors',
          favorited ? 'fill-accent text-accent' : 'text-muted-foreground'
        )}
      />
    </button>
  );
}
