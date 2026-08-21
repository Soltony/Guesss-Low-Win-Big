import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { BrandProvider, DEFAULT_BRAND_NAME } from '@/components/brand-provider';
import { getSettings } from '@/lib/settings';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// Resolved per request rather than declared statically: the platform name is a
// setting, so the tab title and the template every page title hangs off it have
// to follow it. The icon stays a fixed URL that resolves the current artwork —
// see `app/brand/logo`.
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const name = String(settings['platform.name'] || DEFAULT_BRAND_NAME);
  const tagline = String(settings['platform.tagline'] || '');

  return {
    title: {
      default: `${name} — Bid Low! Win Big!`,
      template: `%s | ${name}`,
    },
    description:
      tagline ||
      `${name} is a Lowest Unique Bid Auction platform. Submit the lowest unique bid and win premium items at a fraction of their actual price.`,
    icons: {
      icon: '/brand/logo',
      shortcut: '/brand/logo',
      apple: '/brand/logo',
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#7DBE3C',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Settings are cached in-process for a few seconds, so this costs one query
  // per cache window rather than one per request.
  const settings = await getSettings();
  const logoUrl = String(settings['platform.logoUrl'] ?? '');
  const name = String(settings['platform.name'] || DEFAULT_BRAND_NAME);

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased">
        <BrandProvider name={name} logoUrl={logoUrl}>
          {children}
        </BrandProvider>
        <Toaster />
      </body>
    </html>
  );
}
