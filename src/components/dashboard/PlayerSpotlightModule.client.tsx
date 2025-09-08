'use client';

import { useMemo, useState, useEffect } from 'react';

import { motion, useReducedMotion } from 'framer-motion';

interface FeaturedPlayer {
  name: string;
  position: string;
  team: string;
  form: number[];
  stats: {
    avgPoints: number;
    lastRound: number;
    ownership: number;
    price: number;
  };
  spotlight: string;
}

interface PlayerSpotlightModuleProps {
  refreshTrigger: number;
}

export default function PlayerSpotlightModuleClient({
  refreshTrigger,
}: PlayerSpotlightModuleProps) {
  const reduceMotion = useReducedMotion();

  // Replace hard-coded featuredPlayer with dynamic data fetching
  const [featuredPlayer, setFeaturedPlayer] = useState<FeaturedPlayer | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchFeaturedPlayer = async () => {
      try {
        setIsLoading(true);
        // Implement actual data fetching logic here
        const response = await fetch('/api/featured-player');
        const data = await response.json();
        setFeaturedPlayer(data);
      } catch (error) {
        console.error('Failed to fetch featured player:', error);
        // Set fallback data or keep null
      } finally {
        setIsLoading(false);
      }
    };

    void fetchFeaturedPlayer();
  }, [refreshTrigger]);

  // Memoized recent-form trend and max value to avoid recalculation on every render
  const formTrend = useMemo(() => {
    if (!featuredPlayer?.form) return 'average';
    const recent = featuredPlayer.form.slice(-3);
    const avg = recent.reduce((sum, score) => sum + score, 0) / (recent.length || 1);
    return avg > 120 ? 'excellent' : avg > 100 ? 'good' : 'average';
  }, [featuredPlayer?.form]);

  const maxForm = useMemo(
    () => (featuredPlayer?.form?.length ? Math.max(...featuredPlayer.form) : 0),
    [featuredPlayer?.form],
  );

  // Show loading state while fetching data
  if (isLoading || !featuredPlayer) {
    return (
      <div className="space-y-4">
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg p-4 text-white">
          <div className="animate-pulse">
            <div className="flex items-center space-x-3">
              <div className="w-16 h-16 bg-white/20 rounded-full"></div>
              <div className="flex-1">
                <div className="h-4 bg-white/20 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-white/20 rounded w-1/2"></div>
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="h-4 bg-slate-200 rounded mb-1"></div>
              <div className="h-3 bg-slate-200 rounded w-2/3 mx-auto"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg p-4 text-white">
        <div className="relative z-10">
          <div className="flex items-center space-x-3">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
              <span className="text-2xl font-bold">
                {featuredPlayer.name
                  .trim()
                  .split(' ')
                  .filter(Boolean)
                  .map((n) => n.charAt(0))
                  .join('') || ''}
              </span>
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-lg">{featuredPlayer.name}</h4>
              <div className="flex items-center space-x-2 text-sm opacity-90">
                <span className="px-2 py-0.5 bg-white/20 rounded">{featuredPlayer.position}</span>
                <span>{featuredPlayer.team}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 right-0 w-32 h-32 transform rotate-12 translate-x-8 -translate-y-8">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="50" cy="50" r="20" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-slate-900">{featuredPlayer.stats.avgPoints}</p>
          <p className="text-xs text-slate-600">Season Avg</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-slate-900">{featuredPlayer.stats.lastRound}</p>
          <p className="text-xs text-slate-600">Last Round</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-slate-900">{featuredPlayer.stats.ownership}%</p>
          <p className="text-xs text-slate-600">Owned</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <p className="text-lg font-bold text-slate-900">
            ${(featuredPlayer.stats.price / 1000).toFixed(0)}k
          </p>
          <p className="text-xs text-slate-600">Price</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h5 className="text-sm font-medium text-slate-700">Recent Form</h5>
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              formTrend === 'excellent'
                ? 'bg-green-100 text-green-700'
                : formTrend === 'good'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-yellow-100 text-yellow-700'
            }`}
          >
            {formTrend}
          </span>
        </div>
        <div className="flex items-end space-x-1 h-12">
          {featuredPlayer.form.map((score, index) => (
            <motion.div
              key={index}
              initial={reduceMotion ? undefined : { height: 0 }}
              animate={
                reduceMotion
                  ? undefined
                  : { height: `${(maxForm ? (score / maxForm) * 100 : 0).toFixed(2)}%` }
              }
              transition={reduceMotion ? undefined : { delay: index * 0.1 }}
              className="flex-1 bg-blue-500 rounded-sm min-h-[4px]"
              title={`Round ${index + 1}: ${score} pts`}
            />
          ))}
        </div>
      </div>

      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-sm text-yellow-800">{featuredPlayer.spotlight}</p>
      </div>

      <button
        type="button"
        className="w-full text-center text-sm text-blue-600 hover:text-blue-700 font-medium"
      >
        View Player Profile →
      </button>
    </div>
  );
}
