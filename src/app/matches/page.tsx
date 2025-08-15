'use client';

import React from 'react';
import { AppLayout } from '@/components/navigation';
import { RealTimeMatchCenter } from '@/components/advanced';

export default function MatchesPage() {
  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <RealTimeMatchCenter
          watchlistPlayers={['1', '2']} // TODO: Get from user's actual watchlist
          onPlayerSelect={(player) => {
            console.log('Selected player:', player.name);
            // TODO: Navigate to player detail or show modal
          }}
        />
      </div>
    </AppLayout>
  );
}
