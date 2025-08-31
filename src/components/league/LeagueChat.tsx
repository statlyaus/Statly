'use client';

import { useEffect, useState } from 'react';
import {
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  doc,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';

interface LeagueChatProps {
  leagueId: string;
  currentUserId?: string;
}

interface ChatMessage {
  id: string;
  text: string;
  userId: string;
  createdAt: Date;
}

export default function LeagueChat({ leagueId, currentUserId }: LeagueChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');

  useEffect(() => {
    if (!db) return;
    const messagesRef = collection(db, 'leagues', leagueId, 'chat');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: ChatMessage[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as DocumentData;
        return {
          id: docSnap.id,
          text: (data.text as string) || '',
          userId: (data.userId as string) || '',
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
        };
      });
      setMessages(msgs);
    });
    return () => unsubscribe();
  }, [leagueId]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = newMessage.trim();
    const canSend = Boolean(currentUserId && currentUserId.trim().length > 0 && leagueId);
    if (!db || !text || !canSend) return;
    const messagesRef = collection(db, 'leagues', leagueId, 'chat');
    try {
      await addDoc(messagesRef, {
        text,
        userId: currentUserId!,
        userRef: doc(db, 'users', currentUserId!),
        createdAt: serverTimestamp(),
      });
      setNewMessage('');
    } catch (err) {
      console.error('Failed to send chat message', err);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-lg font-semibold mb-2">League Chat</h3>
      <div className="h-64 overflow-y-auto mb-2 space-y-2">
        {messages.map((msg) => (
          <div key={msg.id} className="text-sm">
            <span className="font-medium">{msg.userId.slice(-4)}:</span>{' '}
            <span>{msg.text}</span>
            <span className="text-xs text-gray-500 ml-2">
              {msg.createdAt.toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
      <form onSubmit={handleSend} className="flex gap-2">
        <input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          className="flex-1 border rounded px-2 py-1 text-sm"
          placeholder="Type a message..."
        />
        <button
          type="submit"
          className="px-3 py-1 bg-blue-600 text-white text-sm rounded"
        >
          Send
        </button>
      </form>
    </div>
  );
}

