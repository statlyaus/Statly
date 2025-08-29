'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/AuthContext';
import { DraftProvider } from '@/contexts/DraftContext';
import { UnifiedDraftRoom } from '@/components/draft/UnifiedDraftRoom';
import { DraftErrorBoundary } from '@/components/ui/ErrorBoundary';

export default function DraftPage() {
  const params = useParams();
  const { user } = useAuth();
  const draftId = params.id as string;

  // Redirect if not authenticated
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Authentication Required</h1>
          <p className="text-gray-600">Please sign in to access the draft room.</p>
        </div>
      </div>
    );
  }

  return (
    <DraftErrorBoundary>
      <DraftProvider draftId={draftId} userId={user.uid}>
        <UnifiedDraftRoom draftId={draftId} userId={user.uid} />
      </DraftProvider>
    </DraftErrorBoundary>
  );
}
