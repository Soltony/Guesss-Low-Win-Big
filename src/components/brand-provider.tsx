'use client';

import { createContext, useContext } from 'react';

/**
 * Carries the uploaded app icon down the tree.
 *
 * The mark is rendered inside client components (the admin shell, the mini-app
 * top bar) that cannot read settings themselves, and it appears on nearly every
 * page. Seeding it once from the root layout keeps `Logo` a drop-in component
 * instead of threading a URL through every page that renders a shell.
 */
const BrandLogoContext = createContext('');

export function BrandProvider({
  logoUrl,
  children,
}: {
  logoUrl: string;
  children: React.ReactNode;
}) {
  return <BrandLogoContext.Provider value={logoUrl}>{children}</BrandLogoContext.Provider>;
}

/** The uploaded icon's URL, or '' when the built-in mark should be used. */
export function useBrandLogo() {
  return useContext(BrandLogoContext);
}
