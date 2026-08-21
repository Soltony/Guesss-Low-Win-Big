'use client';

import { createContext, useContext } from 'react';

/**
 * Carries the platform's identity — its name and uploaded app icon — down the
 * tree.
 *
 * Both are rendered inside client components (the admin shell, the mini-app top
 * bar) that cannot read settings themselves, and they appear on nearly every
 * page. Seeding them once from the root layout keeps `Logo` and `LogoWordmark`
 * drop-in components instead of threading two values through every page that
 * renders a shell.
 */

export const DEFAULT_BRAND_NAME = 'GuessLow';

interface Brand {
  name: string;
  logoUrl: string;
}

const BrandContext = createContext<Brand>({ name: DEFAULT_BRAND_NAME, logoUrl: '' });

export function BrandProvider({
  name,
  logoUrl,
  children,
}: {
  name: string;
  logoUrl: string;
  children: React.ReactNode;
}) {
  return (
    <BrandContext.Provider value={{ name: name || DEFAULT_BRAND_NAME, logoUrl }}>
      {children}
    </BrandContext.Provider>
  );
}

/** The uploaded icon's URL, or '' when the built-in mark should be used. */
export function useBrandLogo() {
  return useContext(BrandContext).logoUrl;
}

/** The configured platform name, falling back to the built-in one. */
export function useBrandName() {
  return useContext(BrandContext).name;
}

/**
 * Splits a wordmark for the two-tone treatment the header uses: "GuessLow"
 * renders as "Guess" + a highlighted "Low". The break is the last capital that
 * follows a lowercase letter, so any camel-cased brand name gets the same
 * look and anything else — "Acme", "Bid Low" — simply renders whole.
 */
export function splitBrandName(name: string): [string, string] {
  const match = /^(.*[a-z])([A-Z][^A-Z]*)$/.exec(name.trim());
  return match ? [match[1], match[2]] : [name.trim(), ''];
}
