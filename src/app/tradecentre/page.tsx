// src/app/tradecentre/page.tsx
'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';

import { SmartTradeAnalyzer } from '@/components/advanced';
import { AppLayout } from '@/components/navigation';
import { LoadingSpinner } from '@/components/ui';

interface Player {
  id: string;
  name: string;
  team: string;
  position: string;
  price: number;
  averageScore: number;
  ownership: number;
  form: number[];
  injuryRisk: 'low' | 'medium' | 'high';
  upcomingFixtures: {
    round: number;
    opponent: string;
    venue: 'home' | 'away';
    difficulty: 1 | 2 | 3 | 4 | 5;
  }[];
}

export default function TradeCentrePage() {
  const [loading, setLoading] = useState(true);
  const [currentTeam, setCurrentTeam] = useState<Player[]>([]);
  const [availableTrades, setAvailableTrades] = useState(2);
  const [budget, setBudget] = useState(75000);
  const [_error, _setError] = useState(false);

  useEffect(() => {
    // Simulate loading team data - in real app this would fetch from API
    const timer = setTimeout(() => {
      try {
        // Mock data for now - replace with actual API call
        setCurrentTeam([]);
        setLoading(false);
      } catch (_error) {
        // Error handling could be added here if needed
        console.error('Failed to load trade data:', _error);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const handleExecuteTrade = (playerOut: Player, playerIn: Player) => {
    console.log('Executing trade:', playerOut.name, '→', playerIn.name);

    // Update team
    setCurrentTeam((prev) =>
      prev.map((player) => (player.id === playerOut.id ? playerIn : player))
    );

    // Update available trades
    setAvailableTrades((prev) => prev - 1);

    // Update budget
    setBudget((prev) => prev - (playerIn.price - playerOut.price));

    // In a real app, this would call an API
    alert(`Trade successful: ${playerOut.name} → ${playerIn.name}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading Trade Centre...</p>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <SmartTradeAnalyzer
          currentTeam={currentTeam}
          availableTrades={availableTrades}
          budget={budget}
          onExecuteTrade={handleExecuteTrade}
        />
      </div>
    </AppLayout>
  );
}
