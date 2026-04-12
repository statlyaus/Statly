'use client';

import { useEffect, useState } from 'react';

import type { League } from '@/types/leagues';

interface InviteModalProps {
  league: League;
  isOpen: boolean;
  onClose: () => void;
}

export default function InviteModal({ league, isOpen, onClose }: InviteModalProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [joinUrl, setJoinUrl] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setJoinUrl(`${window.location.origin}/leagues/join?code=${league.code}`);
  }, [league.code]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(league.code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
      <div className="w-full max-w-md rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-6 shadow-[0_24px_60px_-35px_rgba(23,34,48,0.35)]">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-[color:var(--league-text)]">Invite Managers</h3>
          <button
            onClick={onClose}
            className="text-[color:var(--league-text-muted)] transition hover:text-[color:var(--league-text)]"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-3 text-sm text-[color:var(--league-text-muted)]">
              Share the full league code or direct join link to invite managers to{' '}
              <strong>{league.name}</strong>.
            </p>
          </div>

          {/* League Code */}
          <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] p-4">
            <div className="mb-2 block text-sm font-medium text-[color:var(--league-text)]">
              League Code
            </div>
            <div className="flex items-center space-x-2">
              <code className="flex-1 rounded-xl border border-[color:var(--league-border)] bg-white p-2 text-center font-mono text-xl tracking-widest text-[color:var(--league-primary)]">
                {league.code}
              </code>
              <button
                onClick={handleCopyCode}
                className="rounded-full bg-[color:var(--league-primary)] px-3 py-2 text-white transition-colors hover:bg-[color:var(--league-primary-hover)]"
              >
                {copiedCode ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Join Link */}
          <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] p-4">
            <div className="mb-2 block text-sm font-medium text-[color:var(--league-text)]">
              Direct Join Link
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={joinUrl}
                readOnly
                placeholder="Join link available in browser"
                className="flex-1 rounded-xl border border-[color:var(--league-border)] bg-white p-2 text-sm text-[color:var(--league-text-muted)]"
              />
              <button
                onClick={handleCopyLink}
                className="rounded-full bg-[color:var(--league-accent)] px-3 py-2 text-white transition-colors hover:brightness-110"
              >
                {copiedLink ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Instructions */}
          <div className="space-y-1 text-sm text-[color:var(--league-text-muted)]">
            <p>
              <strong>How to join:</strong>
            </p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Share the code or link with friends</li>
              <li>They visit the app and click &quot;Join League&quot;</li>
              <li>
                Enter the full code:{' '}
                <code className="rounded bg-white px-1 text-[color:var(--league-primary)]">
                  {league.code}
                </code>
              </li>
              <li>Choose a team name and join!</li>
            </ol>
          </div>

          {/* League Info */}
          <div className="border-t border-[color:var(--league-border)] pt-4 text-sm text-[color:var(--league-text-muted)]">
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
            className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-2 text-[color:var(--league-text-muted)] transition-colors hover:bg-white hover:text-[color:var(--league-text)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
