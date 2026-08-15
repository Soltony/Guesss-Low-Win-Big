import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { BrandProvider } from '@/components/brand-provider';
import { getSettings } from '@/lib/settings';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'GuessLow — Bid Low! Win Big!',
    template: '%s | GuessLow',
  },
  description:
    'GuessLow is a Lowest Unique Bid Auction platform. Submit the lowest unique bid and win premium items at a fraction of their actual price.',
  // A fixed URL that resolves the current icon per request, so uploading a new
  // one takes effect without this static metadata being regenerated.
  icons: {
    icon: '/brand/logo',
    shortcut: '/brand/logo',
    apple: '/brand/logo',
  },
};

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

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased">
        <BrandProvider logoUrl={logoUrl}>{children}</BrandProvider>
        <Toaster />
      </body>
    </html>
  );
}
