'use client';

import type { ReactNode } from 'react';

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
          <LeagueSocialWidget currentUserId={user.uid} />
        </SocketProvider>
      ) : (
        children
      )}
    </LeagueSocialWidgetProvider>
  );
}
