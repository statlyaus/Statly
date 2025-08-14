'use client';

import React from 'react';
import Link from 'next/link';
import { RealTimeMatchCenter } from '@/components/advanced';

export default function MatchesPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                ← Dashboard
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">Live Matches</h1>
            </div>
            <div className="flex items-center gap-4">
              <Link 
                href="/tradecentre" 
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                Trade Centre
              </Link>
              <Link 
                href="/rankings" 
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                Rankings
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <RealTimeMatchCenter 
          watchlistPlayers={['1', '2']} // TODO: Get from user's actual watchlist
          onPlayerSelect={(player) => {
            console.log('Selected player:', player.name);
            // TODO: Navigate to player detail or show modal
          }}
        />
      </div>
    </div>
  );
}
