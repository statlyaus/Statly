'use client';

import React from 'react';

import { useAuth } from '@/AuthContext';
import { AppLayout } from '@/components/navigation';
import TeamAnalyticsDashboard from '@/components/team/TeamAnalyticsDashboard';
import { LoadingSpinner } from '@/components/ui';

export default function TeamAnalyticsClient() {
  const { user, loading } = useAuth();

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const userParam = urlParams.get('user');
      if (userParam === 'addison' || userParam === 'addisonarmadale@gmail.com') {
        localStorage.setItem('preferredUser', 'addison');
      } else if (userParam === 'test') {
        localStorage.setItem('preferredUser', 'test');
      }
    }
  }, []);

  if (loading) {
    return <LoadingSpinner />;
  }

  const isTestMode = !user || process.env.NODE_ENV === 'development';

  if (!user && process.env.NODE_ENV === 'production') {
    return (
      <AppLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600">Please sign in to view your team analytics.</p>
            <div className="mt-4">
              <button
                onClick={() => (window.location.href = '/auth/signin')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Sign In
              </button>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {isTestMode && !user && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 mx-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                <strong>Development Mode:</strong> Viewing team analytics with test data. Sign in to
                see your real teams.
              </p>
            </div>
          </div>
        </div>
      )}
      <TeamAnalyticsDashboard />
    </AppLayout>
  );
}

