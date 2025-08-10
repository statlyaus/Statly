import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import '@/index.css';
import { AuthProvider } from '@/AuthContext';
import Link from 'next/link';
import AuthHeader from '@/components/AuthHeader';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Statly - Fantasy AFL',
  description: 'A fantasy sports platform for the Australian Football League (AFL)',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body className={inter.className}>
        <AuthProvider>
          <header className="bg-base-200 p-4 flex justify-between items-center shadow-md">
            <Link href="/" className="text-xl font-bold btn btn-ghost">
              Statly
            </Link>
            <AuthHeader />
          </header>
          <main className="p-4">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
