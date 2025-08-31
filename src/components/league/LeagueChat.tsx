import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';

interface LeagueChatProps {
  leagueId: string;
}

export default function LeagueChat({ leagueId }: LeagueChatProps) {
  const [_messages, _setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leagueId) return;

    const q = query(collection(db, "someCollection"), orderBy("someField"), limit(200));

    const unsubscribe = onSnapshot(q, (_snapshot) => {
      // handle snapshot
      setLoading(false);
    }, (error) => {
      console.error("Error fetching data: ", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [leagueId]);

  if (loading) {
    return <div>Loading chat...</div>;
  }

  return (
    <div className="league-chat">
      <h3>League Chat</h3>
      <p>Chat functionality coming soon...</p>
    </div>
  );
}
