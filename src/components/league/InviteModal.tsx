'use client';

import { useState, useMemo } from 'react';
import type { League } from '@/types/leagues';

interface InviteModalProps {
  league: League;
  isOpen: boolean;
  onClose: () => void;
}

export default function InviteModal({ league, isOpen, onClose }: InviteModalProps) {
  const [copied, setCopied] = useState(false);
  
  const joinUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    try {
      return new URL(
        `/leagues/join?code=${encodeURIComponent(league.code)}`,
        window.location.origin
      ).toString();
    } catch {
      return '';
    }
  }, [league.code]);
  
  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(league.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Invite Players</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-600 mb-3">
              Share this code with friends to invite them to <strong>{league.name}</strong>
            </p>
          </div>

          {/* League Code */}
          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="block text-sm font-medium text-gray-700 mb-2">
              League Code
            </div>
            <div className="flex items-center space-x-2">
              <code className="flex-1 text-xl font-mono tracking-widest text-center p-2 bg-white border rounded">
                {league.code}
              </code>
              <button
                onClick={handleCopyCode}
                className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Join Link */}
          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="block text-sm font-medium text-gray-700 mb-2">
              Direct Join Link
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={joinUrl}
                readOnly
                className="flex-1 text-sm p-2 bg-white border rounded text-gray-600"
              />
              <button
                onClick={handleCopyLink}
                className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Instructions */}
          <div className="text-sm text-gray-600 space-y-1">
            <p><strong>How to join:</strong></p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Share the code or link with friends</li>
              <li>They visit the app and click &quot;Join League&quot;</li>
              <li>Enter the code: <code className="bg-gray-100 px-1 rounded">{league.code}</code></li>
              <li>Choose a team name and join!</li>
            </ol>
          </div>

          {/* League Info */}
          <div className="border-t pt-4 text-sm text-gray-600">
            <div className="flex justify-between">
              <span>Max Teams:</span>
              <span>{league.maxTeams}</span>
            </div>
            <div className="flex justify-between">
              <span>Status:</span>
              <span className="capitalize">{league.status}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
