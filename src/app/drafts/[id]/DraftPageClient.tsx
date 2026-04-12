'use client';

import React from 'react';

import UnifiedDraftRoom from '@/components/draft/UnifiedDraftRoom';
import { DraftProvider } from '@/contexts/DraftContext';
import { SocketProvider } from '@/contexts/SocketContext';

export default function DraftPageClient({
  draftId,
  userId,
  initialSnapshot,
}: {
  draftId: string;
  userId: string;
  // Keep this broad/serializable; exact shape normalized in provider
  initialSnapshot: Record<string, any> | null;
}) {
  return (
    <SocketProvider>
      <DraftProvider draftId={draftId} userId={userId} initialSnapshot={initialSnapshot as any}>
        <UnifiedDraftRoom draftId={draftId} userId={userId} />
      </DraftProvider>
    </SocketProvider>
  );
}
