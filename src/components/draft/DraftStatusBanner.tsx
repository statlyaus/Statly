'use client';

import { useState } from 'react';

interface DraftStatusBannerProps {
  status: string;
  onStartDraft?: () => void;
  isLoading?: boolean;
}

export default function DraftStatusBanner({
  status,
  onStartDraft,
  isLoading = false,
}: DraftStatusBannerProps) {
  const [localLoading, setLocalLoading] = useState(false);

  const handleStartDraft = async () => {
    if (!onStartDraft) return;

    setLocalLoading(true);
    try {
      await onStartDraft();
    } finally {
      setLocalLoading(false);
    }
  };

  const isActuallyLoading = isLoading || localLoading;

  // Scheduled draft banner
  if (status === 'SCHEDULED') {
    return (
      <div className="w-full px-4 py-3 bg-indigo-600 text-white">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="font-medium">Draft is scheduled - Waiting for participants</span>
          </div>
          {onStartDraft && (
            <button
              onClick={handleStartDraft}
              disabled={isActuallyLoading}
              className="bg-white text-indigo-600 px-4 py-2 rounded-md font-medium hover:bg-gray-100 disabled:opacity-50 flex items-center space-x-2"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              <span>{isActuallyLoading ? 'Starting...' : 'Start Draft Now'}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Completed draft banner
  if (status === 'COMPLETED') {
    return (
      <div className="w-full px-4 py-3 bg-green-600 text-white">
        <div className="max-w-7xl mx-auto flex items-center justify-center">
          <div className="flex items-center space-x-2">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="font-medium">Draft completed successfully! 🎉</span>
          </div>
        </div>
      </div>
    );
  }

  // Live draft banner
  if (status === 'LIVE') {
    return (
      <div className="w-full px-4 py-3 bg-green-600 text-white">
        <div className="max-w-7xl mx-auto flex items-center justify-center">
          <div className="flex items-center space-x-2">
            <svg
              className="h-5 w-5 animate-pulse"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <span className="font-medium">Draft is live! Make your picks</span>
          </div>
        </div>
      </div>
    );
  }

  // Paused draft banner (handled by DraftControls component)
  if (status === 'PAUSED') {
    return null; // This is handled by DraftControls
  }

  // Default banner for other statuses
  return (
    <div className="w-full px-4 py-3 bg-gray-600 text-white">
      <div className="max-w-7xl mx-auto flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="font-medium">Draft Status: {status}</span>
        </div>
      </div>
    </div>
  );
}
