'use client';

import { useEffect, useState, useRef, FormEvent } from 'react';
import { db } from '@/lib/firebaseClient';
import {
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';

interface LobbyChatProps {
  draftId: string;
  memberId: string;
}

interface ChatMessage {
  id: string;
  text: string;
  memberId: string;
  createdAt?: Date;
}

export default function LobbyChat({ draftId, memberId }: LobbyChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!db) return; // Firestore not configured
    const messagesRef = collection(db, 'drafts', draftId, 'chat');
    const q = query(messagesRef, orderBy('createdAt'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: ChatMessage[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as DocumentData),
        createdAt: doc.data().createdAt?.toDate?.(),
      }));
      setMessages(data);
    });
    return () => unsubscribe();
  }, [draftId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!db || !newMessage.trim()) return;
    try {
      await addDoc(collection(db, 'drafts', draftId, 'chat'), {
        text: newMessage.trim(),
        memberId,
        createdAt: serverTimestamp(),
      });
      setNewMessage('');
    } catch (err) {
      console.error('Failed to send message', err);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col h-80">
      <div className="p-4 border-b">
        <h2 className="text-lg font-semibold text-gray-900">💬 Lobby Chat</h2>
      </div>
      <div className="flex-1 p-4 overflow-y-auto space-y-2">
        {messages.map((msg) => (
          <div key={msg.id} className="text-sm">
            <span className="font-medium text-gray-800">{msg.memberId}:</span>{' '}
            <span className="text-gray-700 break-words">{msg.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={sendMessage} className="p-4 border-t flex gap-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          placeholder="Type a message..."
        />
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
        >
          Send
        </button>
      </form>
    </div>
  );
}

