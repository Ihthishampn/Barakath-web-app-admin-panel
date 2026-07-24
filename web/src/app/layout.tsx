import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import { Toaster } from 'sonner';
import { AuthInit } from '@/components/AuthInit';
import { PushBridge } from '@/components/PushBridge';
import { SITE_URL } from '@/lib/seo';
import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});

export const metadata: Metadata = {
  // Resolves the relative URLs the per-page Open Graph/canonical tags emit.
  metadataBase: new URL(SITE_URL),
  title: 'Barakath — Perfumes, Books, Clothing & Islamic Essentials',
  description: 'Premium perfumes, books, clothing and Islamic products. India-only, delivered.',
  openGraph: {
    type: 'website',
    siteName: 'Barakath',
    url: SITE_URL,
    title: 'Barakath — Perfumes, Books, Clothing & Islamic Essentials',
    description: 'Premium perfumes, books, clothing and Islamic products. India-only, delivered.',
  },
  twitter: {
    card: 'summary',
    title: 'Barakath — Perfumes, Books, Clothing & Islamic Essentials',
    description: 'Premium perfumes, books, clothing and Islamic products. India-only, delivered.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>
        <AuthInit />
        <PushBridge />
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
