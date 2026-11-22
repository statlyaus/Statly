import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Caveat, Geist, Saira } from 'next/font/google';

import '@/index.css';

import { PageErrorBoundary } from '@/components/ui/ErrorBoundary';
import MotionPreferenceProvider from '@/providers/MotionPreferenceProvider';

// The three brand typefaces (docs/product/style-guide.md, "Type"): Geist for display and UI, Saira
// for reading and table numbers, Caveat for one hand note per view.
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
});
const saira = Saira({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-saira',
});
const caveat = Caveat({
  subsets: ['latin'],
  weight: ['700'],
  variable: '--font-caveat',
  // The home masthead's hand note uses it above the fold.
});

export const metadata: Metadata = {
  title: 'Statly',
  description: 'AFL trades, valued by what the players and picks went on to do.',
  // The brand board's Sherrin tile. The PNG is the fallback for browsers without SVG favicons.
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/brand/statly-sherrin-icon-180.png', type: 'image/png', sizes: '180x180' },
    ],
    apple: '/brand/statly-sherrin-icon-180.png',
  },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${geist.variable} ${saira.variable} ${caveat.variable}`}
    >
      <body className="font-sans" suppressHydrationWarning>
        <PageErrorBoundary name="RootLayout">
          <MotionPreferenceProvider>{children}</MotionPreferenceProvider>
        </PageErrorBoundary>
      </body>
    </html>
  );
}
