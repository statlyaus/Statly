'use client';

import React from 'react';

export default function ActivityFeed() {
  return (
    <aside
      aria-label="Activity feed"
      className="p-4 border-l border-neutral-200 w-full md:w-80 bg-white"
    >
      <div className="text-sm font-semibold mb-2">Activity</div>
      <div className="text-xs text-neutral-600">No recent activity</div>
    </aside>
  );
}
