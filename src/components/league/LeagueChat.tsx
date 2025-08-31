'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  PaperAirplaneIcon,
  ChatBubbleBottomCenterTextIcon,
  UserIcon,
} from '@heroicons/react/24/outline';

interface ChatMessage {
  id: string;
  userId?: string;
  userName: string;
  message: string;
  timestamp: string;
  isCurrentUser?: boolean;
}

interface LeagueChatProps {
  leagueId: string;
  currentUserId?: string;
  canSend: boolean;
}

export default function LeagueChat({ leagueId, currentUserId, canSend }: LeagueChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      userId: 'user1',
      userName: 'Alex',
      message: 'Good luck everyone this season!',
      timestamp: '2025-01-02T10:30:00Z',
    },
    {
      id: '2',
      userId: 'user2',
      userName: 'Sarah',
      message: 'Anyone else targeting Bontempelli early?',
      timestamp: '2025-01-02T11:15:00Z',
    },
    {
      id: '3',
      userId: 'user3',
      userName: 'Mike',
      message: 'Draft is tomorrow! Ready to dominate 🏆',
      timestamp: '2025-01-02T14:22:00Z',
    },
  ]);
  
  const [messageInput, setMessageInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Only create user-specific refs when currentUserId is defined
  const userSpecificRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!canSend || !messageInput.trim() || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    
    try {
      // Create new message
      const newMessage: ChatMessage = {
        id: Date.now().toString(),
        userId: currentUserId,
        userName: currentUserId ? 'You' : 'Guest',
        message: messageInput.trim(),
        timestamp: new Date().toISOString(),
        isCurrentUser: Boolean(currentUserId),
      };

      // Add message to local state (in real implementation, this would send to API)
      setMessages(prev => [...prev, newMessage]);
      setMessageInput('');
      
      // Focus back to input
      inputRef.current?.focus();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return date.toLocaleTimeString('en-AU', { 
        hour: 'numeric', 
        minute: '2-digit' 
      });
    }
    
    return date.toLocaleDateString('en-AU', { 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="bg-white rounded-xl shadow-lg flex flex-col h-96"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center space-x-2">
          <ChatBubbleBottomCenterTextIcon className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">League Chat</h2>
        </div>
        <div className="text-xs text-gray-500">
          {messages.length} message{messages.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length > 0 ? (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex items-start space-x-3 ${
                message.isCurrentUser ? 'flex-row-reverse space-x-reverse' : ''
              }`}
            >
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                <UserIcon className="w-4 h-4 text-blue-600" />
              </div>
              <div className={`flex-1 max-w-xs ${message.isCurrentUser ? 'text-right' : ''}`}>
                <div className="flex items-center space-x-1 mb-1">
                  <span className="text-xs font-medium text-gray-900">
                    {message.userName}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatTimestamp(message.timestamp)}
                  </span>
                </div>
                <div
                  className={`inline-block p-2 rounded-lg text-sm ${
                    message.isCurrentUser
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  {message.message}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-8 text-gray-500">
            <ChatBubbleBottomCenterTextIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm">No messages yet</p>
            <p className="text-xs mt-1">Start the conversation!</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200">
        {canSend ? (
          <form onSubmit={handleSendMessage} className="flex space-x-2">
            <input
              ref={inputRef}
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder="Type a message..."
              disabled={isSubmitting}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              maxLength={500}
            />
            <button
              type="submit"
              disabled={!messageInput.trim() || isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <PaperAirplaneIcon className="w-4 h-4" />
              )}
            </button>
          </form>
        ) : (
          <div className="text-center py-3">
            <p className="text-sm text-gray-500">
              {currentUserId ? 'You cannot send messages in this chat' : 'Sign in to participate in chat'}
            </p>
          </div>
        )}
      </div>

      {/* User-specific ref only rendered when currentUserId is defined */}
      {currentUserId && <div ref={userSpecificRef} style={{ display: 'none' }} />}
    </motion.div>
  );
}