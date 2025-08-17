'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import LeagueOverview from '@/components/league/LeagueOverview'; // Corrected: default import
import { useParams } from 'next/navigation';
import { useAuth } from '@/AuthContext';
import type { League, LeagueMember } from '@/types/leagues';
import { LoadingSpinner } from '@/components/ui';

export default function LeaguePage() {
  const params = useParams();
  const { user } = useAuth();
  // Ensure params and id exist before using them
  const id = params?.id as string;
  const [league, setLeague] = useState<League | null>(null);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Don't fetch if the ID isn't available yet
    if (!id) {
      setLoading(false);
      return;
    }

    const getLeagueData = async () => {
      try {
        setLoading(true);
        // The league API returns both league and members data
        const response = await fetchApi(`leagues/${id}`);
        
        if (response.success && response.data) {
          setLeague(response.data.league);
          setMembers(response.data.members || []);
        } else {
          throw new Error('Invalid response format');
        }
      } catch (err) {
        setError('Failed to fetch league data.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    getLeagueData();
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <p className="text-red-500 text-center">{error}</p>;
  }

  if (!league) {
    // You can either show a "not found" page or a different message
    return <p className="text-center">League not found.</p>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">{league.name}</h1>
      <LeagueOverview league={league} members={members} currentUserId={user?.uid} />
    </div>
  );
}