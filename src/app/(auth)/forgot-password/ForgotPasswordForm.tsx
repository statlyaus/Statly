'use client';

import { useState } from 'react';

import { Mail } from 'lucide-react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { motion } from 'framer-motion';

import Alert from '@/components/ui/Alert';
import Button from '@/components/Button';
import { UILabel, UIInput } from '@/components/ui';
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
    <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
      <div className="p-6">
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="space-y-1.5">
            <UILabel htmlFor="email" className="block">
              Email Address
              <span className="ml-1 text-destructive" aria-label="required">
                *
              </span>
            </UILabel>
            <div className="relative">
              <UIInput
                id="email"
                type="email"
                className="pl-10"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Mail
                className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          </div>

          {error && (
            <Alert type="error" variant="light">
              {error}
            </Alert>
          )}
          {success && (
            <Alert type="success" variant="light">
              {success}
            </Alert>
          )}

          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              type="submit"
              className="w-full"
              disabled={submitting}
              loading={submitting}
              leftIcon={!submitting ? <Mail className="h-5 w-5" /> : undefined}
            >
              {submitting ? 'Sending reset link...' : 'Send reset link'}
            </Button>
          </motion.div>
        </form>
      </div>
    </div>
  );
}
