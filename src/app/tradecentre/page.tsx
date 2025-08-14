// src/app/tradecentre/page.tsx
'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SmartTradeAnalyzer } from '@/components/advanced';
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
  const [error, setError] = useState(false);

  useEffect(() => {
    // Simulate loading team data - in real app this would fetch from API
    const timer = setTimeout(() => {
      try {
        // Mock data for now - replace with actual API call
        setCurrentTeam([]);
        setLoading(false);
      } catch (_e) {
        setError(true);
        setLoading(false);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const handleExecuteTrade = (playerOut: Player, playerIn: Player) => {
    console.log('Executing trade:', playerOut.name, '→', playerIn.name);
    
    // Update team
    setCurrentTeam(prev => 
      prev.map(player => 
        player.id === playerOut.id ? playerIn : player
      )
    );

    // Update available trades
    setAvailableTrades(prev => prev - 1);
    
    // Update budget
    setBudget(prev => prev - (playerIn.price - playerOut.price));
    
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
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                ← Dashboard
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">Trade Centre</h1>
            </div>
            <div className="flex items-center gap-4">
              <Link 
                href="/rankings" 
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                View Rankings
              </Link>
              <Link 
                href="/leagues" 
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                My Leagues
              </Link>
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <div className="text-red-800 text-lg font-semibold mb-2">
              Unable to load Trade Centre
            </div>
            <p className="text-red-600 mb-4">
              There was an issue loading the trade center. Please try again later.
            </p>
            <div className="flex justify-center gap-4">
              <button
                onClick={() => window.location.reload()}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
              >
                Retry
              </button>
              <Link
                href="/dashboard"
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <SmartTradeAnalyzer
            currentTeam={currentTeam}
            availableTrades={availableTrades}
            budget={budget}
            onExecuteTrade={handleExecuteTrade}
          />
        </div>
      )}
    </main>
  );
}