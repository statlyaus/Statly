'use client';

import { useState } from 'react';

import {
  EnvelopeIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { sendPasswordResetEmail } from 'firebase/auth';
import { motion } from 'framer-motion';

import { auth } from '@/lib/firebaseClient';


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
      setError('Authentication service unavailable');
      return;
    }

    setSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setSuccess('If an account exists for this email, a password reset link has been sent.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send reset email';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl border border-base-300">
      <div className="card-body">
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="form-control">
            <label htmlFor="email" className="label">
              <span className="label-text font-medium flex items-center gap-2">
                <EnvelopeIcon className="w-4 h-4" />
                Email Address
              </span>
            </label>
            <div className="relative">
              <input
                id="email"
                type="email"
                className="input input-bordered w-full pl-10"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <EnvelopeIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40" />
            </div>
          </div>

          {error && (
            <div className="alert alert-error">
              <ExclamationTriangleIcon className="w-5 h-5" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="alert alert-success">
              <CheckCircleIcon className="w-5 h-5" />
              <span>{success}</span>
            </div>
          )}

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            className="btn btn-primary w-full gap-2"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <ArrowPathIcon className="w-5 h-5 animate-spin" />
                Sending reset link...
              </>
            ) : (
              'Send reset link'
            )}
          </motion.button>
        </form>
      </div>
    </div>
  );
}
