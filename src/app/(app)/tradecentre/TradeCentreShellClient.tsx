'use client';

import { useEffect, useState } from 'react';

import { doc, getDoc } from 'firebase/firestore';

import { useAuth } from '@/AuthContext';
import TradeCentreShell from '@/components/TradeCentreShell';
import { db } from '@/lib/firebaseClient';
import { logger } from '@/lib/logger';
import type { PlayerLite } from '@/types/players';

interface Props {
  players: PlayerLite[];
}

export default function TradeCentreShellClient({ players }: Props) {
  const { user } = useAuth();
  const [myTeamId, setMyTeamId] = useState<string | undefined>();

  useEffect(() => {
    if (!user || !db) return;
    const fetchTeam = async () => {
      try {
        const snap = await getDoc(doc(db!, 'users', user.uid));
        const teamId = snap.data()?.teamId as string | undefined;
        setMyTeamId(teamId);
      } catch (err) {
        logger.error('Failed to load team ID', err, { userId: user.uid });
      }
    };
    fetchTeam();
  }, [user]);

  return <TradeCentreShell initialPlayers={players} myTeam={myTeamId} />;
}
