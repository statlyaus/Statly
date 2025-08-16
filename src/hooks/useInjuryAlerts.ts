import { useState, useEffect } from 'react';
import type { Injury } from '@/types/injuries';
import { fetchApi } from '@/lib/api';

export const useInjuryAlerts = (refreshInterval: number = 60000) => {
  const [injuries, setInjuries] = useState<Injury[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchInjuries = async () => {
      try {
        setLoading(true);
        const data = await fetchApi('injuries');
        setInjuries(data);
        setError(null);
      } catch (err) {
        setError('Failed to fetch injury alerts.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchInjuries(); // Initial fetch

    const intervalId = setInterval(fetchInjuries, refreshInterval); // Set up auto-refresh

    return () => clearInterval(intervalId); // Cleanup on unmount
  }, [refreshInterval]);

  return { injuries, loading, error };
};