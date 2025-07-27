import { useState, useEffect, useCallback } from 'react';

interface PlayerStats {
  goals: number;
  assists: number;
  disposals: number;
  [key: string]: number;
}

interface InteractionData {
  id: string;
  type: string;
  payload: PlayerStats;
}

function useInteractionTracker() {
  const [interactions, setInteractions] = useState<InteractionData[]>([]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const data = event.dataTransfer.getData('text/plain');
    try {
      const parsedData: InteractionData = JSON.parse(data);
      setInteractions(prev => [...prev, parsedData]);
    } catch {
      // handle invalid JSON
    }
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const processStat = (stat: PlayerStats) => {
    // process player stats here
  };

  useEffect(() => {
    interactions.forEach(interaction => {
      if (interaction.type === 'statUpdate') {
        processStat(interaction.payload as PlayerStats);
      }
    });
  }, [interactions]);

  return {
    interactions,
    handleDrop,
    handleDragOver,
  };
}


export default useInteractionTracker;