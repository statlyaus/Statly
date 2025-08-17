'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { useParams, notFound } from 'next/navigation';
import Link from 'next/link';
import type { Player } from '@/types/players';
import { PlayerDetail } from '@/components/PlayerDetail';
import { LoadingSpinner } from '@/components/ui';
import { ChevronLeftIcon } from '@heroicons/react/24/outline';
import AppLayout from '@/components/navigation/AppLayout';

export default function PlayerPage() {
  const params = useParams();
  const id = params?.id as string;
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !params) return;

    const getPlayerData = async () => {
      try {
        setLoading(true);
        
        // Try to get player by ID first
        let playerData;
        try {
          playerData = await fetchApi(`players/${id}`);
        } catch (_err) {
          // If that fails, create a mock player object for the PlayerDetail component
          // The PlayerDetail component will handle fetching the actual data
          playerData = {
            id: id,
            name: decodeURIComponent(id),
          };
        }
        
        setPlayer(playerData);
      } catch (err) {
        setError('Failed to fetch player data.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    getPlayerData();
  }, [id, params]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner />
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="p-6">
          <Link 
            href="/players"
            className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-4"
          >
            <ChevronLeftIcon className="w-4 h-4 mr-1" />
            Back to Players
          </Link>
          <p className="text-red-500 text-center">{error}</p>
        </div>
      </AppLayout>
    );
  }

  if (!player) {
    notFound();
  }

  return (
    <AppLayout>
      <div className="bg-gray-50 min-h-screen">
        {/* Navigation Bar */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center">
            <Link 
              href="/players"
              className="inline-flex items-center text-blue-600 hover:text-blue-800 transition-colors"
            >
              <ChevronLeftIcon className="w-5 h-5 mr-2" />
              Back to Players
            </Link>
          </div>
        </div>
        
        {/* Player Detail Content */}
        <PlayerDetail player={player} />
      </div>
    </AppLayout>
  );
}