'use client';

import { Suspense, type ReactNode } from 'react';

import { useAuth } from '@/AuthContext';
import { SocketProvider } from '@/providers/SocketProvider';

import LeagueSocialWidget from './LeagueSocialWidget';
import { LeagueSocialWidgetProvider } from './LeagueSocialWidgetProvider';

export default function LeagueSocialAppProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const { user } = useAuth();

  return (
    <LeagueSocialWidgetProvider>
      {user ? (
        <SocketProvider uid={user.uid}>
          {children}
          {/* The pop-up reads the query string, which needs a Suspense boundary in Next.js. */}
          <Suspense fallback={null}>
            <LeagueSocialWidget currentUserId={user.uid} />
          </Suspense>
        </SocketProvider>
      ) : (
        children
      )}
    </LeagueSocialWidgetProvider>
  );
}
