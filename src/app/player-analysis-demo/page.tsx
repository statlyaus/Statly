// Test page comparing original vs live data integration
'use client';

import { useState } from 'react';

import PlayerAnalysis from '@/components/players/PlayerAnalysis';
import PlayerAnalysisWithLiveData from '@/components/players/PlayerAnalysisWithLiveData';

export default function PlayerAnalysisComparisonPage() {
  const [activeTab, setActiveTab] = useState<'original' | 'live'>('live');

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Tab Navigation */}
      <div className="sticky top-0 z-50 bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex space-x-1 py-4">
            <button
              onClick={() => setActiveTab('live')}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                activeTab === 'live'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              🔴 Live Data Version
            </button>
            <button
              onClick={() => setActiveTab('original')}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                activeTab === 'original'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              📊 Original Mock Data
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="relative">
        {activeTab === 'live' && (
          <div>
            <PlayerAnalysisWithLiveData />
          </div>
        )}

        {activeTab === 'original' && (
          <div>
            <PlayerAnalysis />
          </div>
        )}
      </div>

      {/* Comparison Info Banner */}
      <div className="fixed bottom-4 right-4 bg-slate-800 border border-slate-600 rounded-lg p-4 max-w-sm">
        <h4 className="text-white font-medium mb-2">Migration Demo</h4>
        <p className="text-slate-300 text-sm">
          {activeTab === 'live'
            ? '🔴 This version uses live Firebase data with real-time updates'
            : '📊 This version uses the original mock data implementation'}
        </p>
        <div className="mt-2 text-xs text-slate-400">
          Switch tabs to compare the implementations
        </div>
      </div>
    </div>
  );
}
