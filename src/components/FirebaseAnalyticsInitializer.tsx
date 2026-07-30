'use client';

import { useEffect } from 'react';

export default function FirebaseAnalyticsInitializer(): null {
  useEffect(() => {
    const shouldInitialize =
      process.env.NODE_ENV === 'production' ||
      process.env.NEXT_PUBLIC_ENABLE_DEVELOPMENT_PERFORMANCE_ANALYTICS === 'true';
    if (!shouldInitialize) return;

    void import('@/lib/firebase/clientAnalytics')
      .then(({ initializeFirebaseAnalytics }) => initializeFirebaseAnalytics())
      .catch((error: unknown) => {
        console.warn('Firebase Analytics module loading failed:', error);
      });
  }, []);

  return null;
}
