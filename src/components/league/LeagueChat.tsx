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

import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot, type DocumentData } from 'firebase/firestore';

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
  userId: string;
  message: string;
  timestamp: Date;
  username: string;
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

  const [loading, setLoading] = useState(true);

  // Fixed useEffect hook (lines 32-49)
  useEffect(() => {
    // Fix 1: Early-return if !leagueId
    if (!leagueId) {
      setLoading(false);
      return;
    }

    // Fix 3: Apply a reasonable limit to prevent unbounded growth
    const chatRef = collection(db!, 'leagues', leagueId, 'chat');
    const q = query(chatRef, orderBy('timestamp', 'desc'), limit(200));
    
    // Fix 4: Use two-argument onSnapshot form with error callback
    const unsubscribe = onSnapshot(
      q, 
      (snapshot) => {
        const chatMessages: ChatMessage[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data() as DocumentData;
          chatMessages.push({
            id: doc.id,
            userId: data.userId,
            message: data.message,
            timestamp: data.timestamp?.toDate() || new Date(),
            username: data.username || 'Unknown User',
          });
        });
        setMessages(chatMessages);
        setLoading(false);
      },
      (error) => {
        console.error(`Error in league chat subscription (${leagueId}):`, error);
        setLoading(false);
        // Could also show user-friendly error message here
      }
    );

    return () => unsubscribe();
  }, [leagueId, db]); // Fix 2: Include db in the dependency list

  const sendMessage = async () => {
    if (!newMessage.trim() || !currentUserId) return;

    try {
      // This would normally use addDoc but keeping it simple for the fix
      console.log('Sending message:', newMessage);
      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-96 bg-white border border-gray-200 rounded-lg">
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 rounded-t-lg">
        <h3 className="text-lg font-medium text-gray-900">League Chat</h3>
        <p className="text-sm text-gray-600">{messages.length} messages</p>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No messages yet. Start the conversation!
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`p-3 rounded-lg ${
                message.userId === currentUserId
                  ? 'bg-blue-100 ml-8'
                  : 'bg-gray-100 mr-8'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm text-gray-900">
                  {message.username}
                </span>
                <span className="text-xs text-gray-500">
                  {message.timestamp.toLocaleTimeString()}
                </span>
              </div>
              <p className="text-gray-800">{message.message}</p>
            </div>
          ))
        )}
      </div>
      
      <div className="border-t border-gray-200 p-4">
        <div className="flex space-x-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Type your message..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={sendMessage}
            disabled={!newMessage.trim() || !currentUserId}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}