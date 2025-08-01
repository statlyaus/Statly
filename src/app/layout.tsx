// src/app/layout.tsx
import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Trade Centre',
  description: 'Fantasy AFL Trade Centre powered by Firebase and Tailwind CSS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-950 text-white min-h-screen`}>
        <main className="max-w-6xl mx-auto px-4 py-8">
          <header className="text-center mb-8">
            <h1 className="text-4xl font-extrabold tracking-tight text-primary mb-2">
              Trade Centre
            </h1>
            <p className="text-lg text-gray-400 mb-4">Build your ultimate fantasy AFL team</p>
            {/* Auth Buttons */}
            {/* <AuthHeader /> */}
          </header>

          <section className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <input
              type="text"
              placeholder="Search players..."
              className="input input-bordered w-full bg-gray-800 border-gray-700 text-white placeholder-gray-500"
            />
            <select className="select select-bordered bg-gray-800 border-gray-700 text-white">
              <option>All Teams</option>
              <option>GEEL</option>
              <option>MELB</option>
              <option>WB</option>
            </select>
            <select className="select select-bordered bg-gray-800 border-gray-700 text-white">
              <option>All Positions</option>
              <option>MID</option>
              <option>DEF</option>
              <option>FWD</option>
              <option>RUC</option>
            </select>
          </section>

          <section className="space-y-4">
            {/* Sample card - map these from your player data */}
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 flex flex-col sm:flex-row justify-between items-center hover:border-primary transition">
              <div>
                <h2 className="text-xl font-semibold capitalize">Marcus Bontempelli</h2>
                <p className="text-gray-400 text-sm">WB - MID</p>
                <p className="text-primary text-sm">Avg: 112</p>
              </div>
              <div className="flex gap-2 mt-4 sm:mt-0">
                <button className="btn btn-primary btn-sm">Trade</button>
                <button className="btn btn-outline btn-sm">Watch</button>
              </div>
            </div>
            {/* Repeat above div for other players */}
          </section>

          {children}
        </main>
        {/* </AuthProvider> */}
      </body>
    </html>
  );
}
