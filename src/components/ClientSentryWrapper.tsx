'use client';

import React from 'react';
import '@/lib/sentry-init'; // Initialize Sentry early
import * as Sentry from '@sentry/react';

interface Props {
  children: React.ReactNode;
}

export default function ClientSentryWrapper({ children }: Props) {
  return (
    <Sentry.ErrorBoundary fallback={<div>Something went wrong</div>}>
      {children}
    </Sentry.ErrorBoundary>
  );
}
