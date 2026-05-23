'use client';

import { type ReactElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

import type { League } from '@/types/leagues';

interface InviteModalProps {
  league: League;
  isOpen: boolean;
  onClose: () => void;
}

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) =>
      !element.hasAttribute('hidden') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.tabIndex !== -1
  );
}

export default function InviteModal({
  league,
  isOpen,
  onClose,
}: InviteModalProps): ReactElement | null {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<'code' | 'link' | null>(null);
  const [copyAnnouncement, setCopyAnnouncement] = useState('');
  const titleId = useId();
  const descriptionId = useId();
  const joinLinkId = useId();

  const joinUrl = useMemo(() => {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    return `${base}/leagues/join?code=${encodeURIComponent(league.code)}`;
  }, [league.code]);

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusCloseButton = () => closeButtonRef.current?.focus();
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusCloseButton);
    } else {
      focusCloseButton();
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }

      const focusableElements = getFocusableElements(dialogRef.current);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (!activeElement || !dialogRef.current.contains(activeElement)) {
        event.preventDefault();
        firstFocusable.focus();
        return;
      }

      if (event.shiftKey && activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleCopyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(league.code);
      setCopiedTarget('code');
      setCopyAnnouncement('Invite code copied.');
      setTimeout(() => setCopiedTarget(null), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
      setCopyAnnouncement('Invite code could not be copied.');
    }
  };

  const handleCopyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopiedTarget('link');
      setCopyAnnouncement('Direct join link copied.');
      setTimeout(() => setCopiedTarget(null), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
      setCopyAnnouncement('Direct join link could not be copied.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              League invite
            </p>
            <h2 id={titleId} className="mt-2 text-lg font-semibold text-foreground">
              Invite managers to {league.name}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            aria-label="Close invite managers dialog"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <p id={descriptionId} className="mb-3 text-sm leading-6 text-muted-foreground">
              Share the full league code or direct join link so managers can join{' '}
              <strong>{league.name}</strong>.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-muted p-4">
            <div className="mb-2 block text-sm font-medium text-foreground">League Code</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border border-border bg-background p-2 text-center font-mono text-xl tracking-widest text-foreground">
                {league.code}
              </code>
              <button
                type="button"
                onClick={handleCopyCode}
                className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted"
                aria-label={`Copy invite code ${league.code}`}
              >
                {copiedTarget === 'code' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted p-4">
            <label htmlFor={joinLinkId} className="mb-2 block text-sm font-medium text-foreground">
              Direct Join Link
            </label>
            <div className="flex items-center gap-2">
              <input
                id={joinLinkId}
                type="text"
                value={joinUrl}
                readOnly
                className="min-w-0 flex-1 rounded-md border border-border bg-background p-2 text-sm text-muted-foreground"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted"
                aria-label="Copy direct join link"
              >
                {copiedTarget === 'link' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Direct links prefill the invite code and survive the sign-in redirect.
            </p>
          </div>

          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              <strong>How to join:</strong>
            </p>
            <ol className="ml-2 list-inside list-decimal space-y-1">
              <li>Share the code or link with friends</li>
              <li>They sign in or create a Statly account</li>
              <li>
                Enter the code:{' '}
                <code className="rounded border border-border bg-background px-1 text-foreground">
                  {league.code}
                </code>
              </li>
              <li>Choose a team name and join</li>
            </ol>
          </div>

          <div className="border-t border-border pt-4 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>Max Teams:</span>
              <span className="font-medium text-foreground">{league.maxTeams}</span>
            </div>
            <div className="flex justify-between">
              <span>Status:</span>
              <span className="font-medium capitalize text-foreground">{league.status}</span>
            </div>
          </div>

          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {copyAnnouncement}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
