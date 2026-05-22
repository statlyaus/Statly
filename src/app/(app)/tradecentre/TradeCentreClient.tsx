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

export default function TradeCentreClient() {
  const [loading, setLoading] = useState(true);
  const [currentTeam, setCurrentTeam] = useState<Player[]>([]);
  const [availableTrades, setAvailableTrades] = useState(2);
  const [budget, setBudget] = useState(75000);
  const [_error, _setError] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setCurrentTeam([]);
        setLoading(false);
      } catch (_error) {
        console.error('Failed to load trade data:', _error);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const handleExecuteTrade = (playerOut: Player, playerIn: Player) => {
    console.log('Executing trade:', playerOut.name, '→', playerIn.name);
    setCurrentTeam((prev) =>
      prev.map((player) => (player.id === playerOut.id ? playerIn : player))
    );
    setAvailableTrades((prev) => prev - 1);
    setBudget((prev) => prev - (playerIn.price - playerOut.price));
    alert(`Trade successful: ${playerOut.name} → ${playerIn.name}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-muted-foreground">Loading Trade Centre...</p>
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
