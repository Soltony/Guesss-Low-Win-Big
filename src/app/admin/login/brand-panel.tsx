'use client';

import { useEffect, useState } from 'react';
import { Logo } from '@/components/icons';
import { splitBrandName, useBrandName } from '@/components/brand-provider';

/**
 * The dark half of the sign-in card.
 *
 * Same surface the mini-app hero uses — ink with a gold spotlight over a dot
 * texture — so an operator arriving at the console sees the product they are
 * about to administer rather than a bare form on a white page.
 */

/**
 * A headline, split into segments so the gold the product puts on "low" and
 * "big" survives being typed one character at a time. `\n` is a deliberate
 * line break; the headline renders `whitespace-pre-line`.
 */
interface Segment {
  text: string;
  gold?: boolean;
}

const HEADLINES: Segment[][] = [
  [
    { text: 'Guess ' },
    { text: 'low', gold: true },
    { text: '.\nWin ' },
    { text: 'big', gold: true },
    { text: '.' },
  ],
  [{ text: 'One bid.\nOne ' }, { text: 'winner', gold: true }, { text: '.' }],
];

const TYPE_MS = 58;
const ERASE_MS = 24;
/** How long a finished headline sits before it is erased. */
const HOLD_MS = 2800;
/** Beat between one headline clearing and the next starting. */
const GAP_MS = 420;

const lengthOf = (segments: Segment[]) => segments.reduce((total, s) => total + s.text.length, 0);

function usePrefersReducedMotion() {
  // Starts false so the server render and the first client render agree; the
  // effect corrects it before the typewriter's first tick.
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return reduced;
}

/**
 * Reveals one character per tick, holds the finished line, erases it, then
 * moves to the next. One timer at a time — an interval would drift out of step
 * with the state it is driving.
 */
function useTypewriter(reduced: boolean) {
  const [phrase, setPhrase] = useState(0);
  const [typed, setTyped] = useState(0);
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    if (reduced) return;

    const total = lengthOf(HEADLINES[phrase]);
    const settled = erasing ? typed === 0 : typed === total;
    const delay = settled ? (erasing ? GAP_MS : HOLD_MS) : erasing ? ERASE_MS : TYPE_MS;

    const timer = setTimeout(() => {
      if (!settled) {
        setTyped(erasing ? typed - 1 : typed + 1);
      } else if (erasing) {
        setErasing(false);
        setPhrase((current) => (current + 1) % HEADLINES.length);
      } else {
        setErasing(true);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [phrase, typed, erasing, reduced]);

  const segments = HEADLINES[reduced ? 0 : phrase];
  return { segments, typed: reduced ? lengthOf(segments) : typed };
}

function TypedHeadline() {
  const reduced = usePrefersReducedMotion();
  const { segments, typed } = useTypewriter(reduced);

  // Characters still to reveal, spent segment by segment.
  let budget = typed;

  return (
    // Brand copy, not the page's heading — "Welcome back" on the form is the
    // h1, and a paragraph here keeps the heading order honest.
    //
    // Two lines of height are reserved up front: the second line only exists
    // once the typing reaches the break, and the panel must not jump.
    <p className="min-h-[2.2em] whitespace-pre-line text-[34px] font-extrabold leading-[1.08] tracking-tight sm:text-[40px]">
      {/* The visible text changes every few frames, which is unusable read out
          loud, so assistive tech gets the finished headline once instead. */}
      <span className="sr-only">
        {segments
          .map((segment) => segment.text)
          .join('')
          .replace(/\n/g, ' ')}
      </span>
      <span aria-hidden="true">
        {segments.map((segment, index) => {
          const take = Math.min(segment.text.length, Math.max(budget, 0));
          budget -= take;
          const slice = segment.text.slice(0, take);
          if (!slice) return null;

          return (
            <span key={index} className={segment.gold ? 'text-primary' : undefined}>
              {slice}
            </span>
          );
        })}
        <span className="gl-caret" />
      </span>
    </p>
  );
}

/**
 * Flat geometry behind the copy. Everything is transparent white or brand gold,
 * so the panel keeps working if the ink or primary tokens are retuned.
 */
function PanelDecor() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Everything sits in the corners or along the right edge. The copy runs
          down the left of the panel, and geometry drifting under bold white
          text is the one way this treatment goes wrong. */}

      {/* Soft disc breaking the top-left corner. */}
      <div className="absolute -left-28 -top-28 h-80 w-80 rounded-full bg-white/[0.055]" />
      {/* Capsule tucked under the top edge. */}
      <div className="absolute -top-12 right-12 h-36 w-20 rounded-full bg-white/[0.05]" />
      {/* The panel's own dot texture, punched up and localised. */}
      <div className="absolute right-9 top-[24%] h-10 w-16 opacity-70 [background-image:radial-gradient(hsl(var(--ink-foreground)/0.45)_1.4px,transparent_1.4px)] [background-size:9px_9px]" />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="gl-twinkle absolute right-[4.5rem] top-[46%] h-5 w-5 text-white"
      >
        <path d="M5 5 19 19M19 5 5 19" />
      </svg>
      {/* Small solid dot, the disc's echo, clear of the disc's top edge. Its
          drift is the slowest thing on the page, so the panel is never quite
          still without ever asking to be looked at. */}
      <div className="gl-float absolute bottom-[34%] right-16 h-8 w-8 rounded-full bg-primary" />
      {/* Outlined ring, concentric with the gold disc inside it. Dashed so the
          rotation is legible — a plain circle would turn invisibly. */}
      <div className="gl-spin-slow absolute -bottom-44 -right-16 h-[26rem] w-[26rem] rounded-full border border-dashed border-white/[0.16]" />
      {/* Gold disc breaking the bottom-right corner. */}
      <div className="absolute -bottom-28 -right-20 h-64 w-64 rounded-full bg-primary/90" />
    </div>
  );
}

export function BrandPanel() {
  const name = useBrandName();
  const [head, tail] = splitBrandName(name);

  return (
    <div className="gl-ink gl-spotlight relative flex min-h-[21rem] flex-col overflow-hidden px-8 py-9 sm:px-11 lg:min-h-[33rem] lg:py-11">
      <div className="gl-dots pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
      <PanelDecor />

      {/* Positioned, so it stacks above the spotlight pseudo-element and decor. */}
      <div className="relative flex flex-1 flex-col">
        <div className="flex items-center gap-2.5">
          <Logo className="h-9 w-9 text-black" />
          <span className="text-[17px] font-bold tracking-tight">
            {head}
            {tail && <span className="text-primary">{tail}</span>}
          </span>
        </div>
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
          Lowest unique bid auction
        </p>

        <div className="flex-1" />

        <TypedHeadline />
        <p className="mt-4 max-w-[19rem] text-sm leading-relaxed text-white/65">
          The lowest amount nobody else picked takes the prize — for a fraction of what it is worth.
        </p>

        <div className="flex-1" />

        <p className="mt-8 flex items-center gap-2.5 text-[13px] text-white/55">
          <span className="gl-live-dot" />
          Auction operations console
        </p>
      </div>
    </div>
  );
}

/**
 * The tag hanging off the top edge of the page, crediting the team that built
 * the console. Fixed text, unlike the wordmark on the panel: the platform can
 * be rebranded through Content -> Branding, but who built it does not change.
 */
export function ConsoleRibbon() {
  return (
    <div
      className="pointer-events-none absolute right-8 top-0 z-10 hidden select-none flex-col items-center sm:flex md:right-16"
      aria-hidden="true"
    >
      {/* The pin. Its halo travels further than the button's, because at 8px
          across a 1.9x ring would barely clear the dot itself. */}
      <span className="gl-halo relative h-2 w-2 rounded-full bg-primary [--gl-halo-scale:3.6]" />

      {/* Everything below the pin swings as one piece, string included. */}
      <div className="gl-sway flex flex-col items-center">
        <span className="h-7 w-px bg-primary/45" />
        {/* Notched banner: square shoulders, a V taken out of the foot. */}
        <span className="gl-ink relative overflow-hidden px-5 pb-6 pt-3 text-center [clip-path:polygon(0_0,100%_0,100%_100%,50%_76%,0_100%)]">
          <span className="gl-sheen absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          <span className="block text-[8px] font-semibold uppercase tracking-[0.24em] text-white/50">
            System by
          </span>
          <span className="mt-0.5 block text-sm font-extrabold uppercase tracking-wider text-primary">
            EPMO
          </span>
        </span>
      </div>
    </div>
  );
}
