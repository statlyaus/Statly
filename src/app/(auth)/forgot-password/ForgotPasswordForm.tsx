'use client';

import { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase/clientAuth';
import {
  EnvelopeIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

function toResetErrorMessage(err: unknown): string {
  const code = typeof err === 'object' && err && 'code' in err ? String(err.code) : '';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  return "We couldn't send the reset link. Check your connection and try again.";
}

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email) {
      setError('Email is required');
      return;
    }
    if (!auth) {
      setError('Password reset is unavailable right now. Try again in a moment.');
      return;
    }

    setSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess('If an account exists for this email, a password reset link has been sent.');
    } catch (err: unknown) {
      setError(toResetErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-6">
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-semibold text-foreground">
            Email Address
          </label>
          <div className="relative">
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="block h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <EnvelopeIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-md border border-result-loss/30 bg-result-loss/5 p-3 text-sm font-medium text-result-loss"
          >
            <ExclamationTriangleIcon aria-hidden="true" className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-md border border-result-win/30 bg-result-win/5 p-3 text-sm font-medium text-result-win"
          >
            <CheckCircleIcon aria-hidden="true" className="h-5 w-5 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground transition-colors hover:bg-brand-bar/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
        >
          {submitting ? (
            <>
              <ArrowPathIcon aria-hidden="true" className="h-5 w-5 animate-spin" />
              Sending reset link...
            </>
          ) : (
            'Send reset link'
          )}
        </button>
      </form>
    </div>
  );
}
