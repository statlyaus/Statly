import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot, type Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';

interface LeagueChatProps {
  leagueId: string;
  currentUserId?: string;
}

interface LeagueMessage {
  id: string;
  userId: string;
  text: string;
  createdAt?: Date;
}

function toMessageDate(value: Timestamp | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value : value.toDate();
}

export default function LeagueChat({ leagueId, currentUserId: _currentUserId }: LeagueChatProps) {
  const [messages, setMessages] = useState<LeagueMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leagueId || !db) {
      setLoading(false);
      setMessages([]);
      return;
    }

    setLoading(true);
    const q = query(
      collection(db, 'leagues', leagueId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(200)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const nextMessages = snapshot.docs
          .map((doc) => {
            const data = doc.data() as Record<string, unknown>;
            return {
              id: doc.id,
              userId: typeof data.userId === 'string' ? data.userId : '',
              text: typeof data.text === 'string' ? data.text : '',
              createdAt: toMessageDate(data.createdAt as Timestamp | Date | null | undefined),
            };
          })
          .reverse();
        setMessages(nextMessages);
        setLoading(false);
      },
      (error) => {
        console.error(`Error fetching league chat messages (${leagueId}):`, error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [leagueId]);

  if (loading) {
    return <div>Loading chat...</div>;
  }

  return (
    <div className="league-chat rounded-lg border border-border bg-background p-4">
      <h3 className="font-medium text-foreground">League Chat</h3>
      {messages.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No messages yet.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {messages.map((message) => (
            <li key={message.id} className="rounded-md bg-muted p-3">
              <p className="text-sm text-foreground">{message.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {message.userId || 'Unknown user'}
                {message.createdAt && ` • ${message.createdAt.toLocaleString()}`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
