import type { Metadata } from 'next';
import { Playfair_Display, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import SessionProvider from '@/components/SessionProvider';
import ThemeProvider from '@/components/ThemeProvider';
import { Toaster } from 'sonner';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { getSession } from '@/lib/session';
import { BrandProvider } from '@/components/BrandProvider';
import { brandDisplayName, resolveRequestBrand } from '@/lib/firm/web-brand';
import { isDemoDeployment } from '@/lib/demo/guard';
import { resolveRequestDemo } from '@/lib/demo/request';
import DemoBanner from '@/components/DemoBanner';

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

/**
 * The description is the firm's, not the platform's: it is what a link preview
 * of the public intake and portal-login pages shows, so a hardcoded firm name
 * here advertises one tenant on every other tenant's front door. An unmapped
 * host describes the platform and names no one.
 */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await resolveRequestBrand();
  const name = brandDisplayName(brand);
  return {
    title: {
      template: '%s · Lumilex',
      default: 'Lumilex',
    },
    description: name
      ? `${name} — matters, deliverables and client portal, on Lumilex.`
      : 'Lumilex — practice management for law firms.',
    // Next's file-convention icons are emitted once at build time and cannot
    // vary per tenant, so app/icon.svg is the neutral platform mark and the
    // firm's own monogram overrides it here, per request. Each firm is on its
    // own host, so the browser's per-origin favicon cache stays correct.
    ...(brand.monogramUrl
      ? { icons: { icon: brand.monogramUrl, apple: brand.monogramUrl } }
      : {}),
    // The public demo is reached from the marketing site, never from search.
    ...(isDemoDeployment() ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [session, brand, demo] = await Promise.all([
    getSession(),
    resolveRequestBrand(),
    resolveRequestDemo(),
  ]);
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${playfair.variable} ${dmSans.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <ThemeProvider>
          <BrandProvider brand={brand}>
            <SessionProvider initialSession={session}>{children}</SessionProvider>
          </BrandProvider>
          {demo && <DemoBanner />}
          <Toaster position="bottom-right" richColors closeButton />
          <SpeedInsights />
        </ThemeProvider>
      </body>
    </html>
  );
}
