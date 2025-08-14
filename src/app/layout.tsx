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

export default function RootLayout({
  children
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="en" data-theme="light">
      <body className={inter.className}>
        <AuthProvider>
          <header className="bg-base-200 p-4 flex justify-between items-center shadow-md">
            <div className="flex items-center space-x-6">
              <Link href="/" className="text-xl font-bold btn btn-ghost">Statly</Link>
              <nav className="hidden md:flex space-x-4">
                <Link href="/dashboard" className="btn btn-ghost btn-sm">
                  Dashboard
                </Link>
                <Link href="/rankings" className="btn btn-ghost btn-sm">
                  Rankings
                </Link>
                <Link href="/leagues" className="btn btn-ghost btn-sm">
                  Leagues
                </Link>
                <Link href="/leagues/new" className="btn btn-primary btn-sm">
                  Create League
                </Link>
                <Link href="/trade-centre" className="btn btn-ghost btn-sm">
                  Trade Centre
                </Link>
              </nav>
            </div>
            <AuthHeader />
          </header>
          <main className="p-4">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}