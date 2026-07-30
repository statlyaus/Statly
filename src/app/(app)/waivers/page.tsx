'use client';

import React from 'react';
import { useAuth } from '@/AuthContext';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import WaiverFAABSystem from '@/components/waivers/WaiverFAABSystem';

export default function WaiversPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!user) {
    return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600">Please sign in to access waivers.</p>
          </div>
        </div>
    );
  }

  return (
      <WaiverFAABSystem />
  );
}
