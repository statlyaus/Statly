'use client';

import { useEffect, useState } from 'react';
import TradeCentreShell from '@/components/TradeCentreShell';
import { useAuth } from '@/AuthContext';
import { db } from '@/lib/firebaseClient';
import { doc, getDoc } from 'firebase/firestore';
import type { PlayerLite } from '@/types/players';

interface Props {
  players: PlayerLite[];
}

export default function TradeCentreShellClient({ players }: Props) {
  const { user } = useAuth();
  const [myTeamId, setMyTeamId] = useState<string | undefined>();

  useEffect(() => {
    if (!user) return;
    const fetchTeam = async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const teamId = snap.data()?.teamId as string | undefined;
        setMyTeamId(teamId);
      } catch (err) {
        console.error('Failed to load team ID', err);
      }
    };
    fetchTeam();
  }, [user]);

  return <TradeCentreShell initialPlayers={players} myTeam={myTeamId} />;
}
