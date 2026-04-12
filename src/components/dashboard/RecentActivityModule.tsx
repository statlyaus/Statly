import Link from 'next/link';

import { motion } from 'framer-motion';

interface Activity {
  id: string;
  type: 'trade' | 'draft' | 'score' | 'injury' | 'waiver' | 'admin';
  message: string;
  timestamp: Date;
  urgent?: boolean;
}

interface RecentActivityModuleProps {
  activities: Activity[];
  refreshTrigger: number;
}

export default function RecentActivityModule({
  activities,
  refreshTrigger: _refreshTrigger,
}: RecentActivityModuleProps) {
  const getActivityIcon = (type: Activity['type']) => {
    const iconClassName = 'h-4 w-4';

    switch (type) {
      case 'trade':
        return (
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
            <svg className={iconClassName} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
          </div>
        );
      case 'draft':
        return (
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
            <svg className={iconClassName} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 01-3 0m3 0H9m3 0v5"
              />
            </svg>
          </div>
        );
      case 'score':
        return (
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
            <svg className={iconClassName} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
        );
      case 'injury':
        return (
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-700">
            <svg className={iconClassName} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 18.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
        );
      case 'waiver':
        return (
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
            <svg className={iconClassName} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8c-3.314 0-6 1.79-6 4s2.686 4 6 4 6-1.79 6-4-2.686-4-6-4zm0 0V4m0 12v4"
              />
            </svg>
          </div>
        );
      case 'admin':
        return (
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700">
            <svg className={iconClassName} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
        );
    }
  };

  const formatTime = (timestamp: Date) => {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  if (activities.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white">
          <svg
            className="h-6 w-6 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h4 className="text-sm font-semibold text-slate-900">No recent movement</h4>
        <p className="mt-1 text-sm text-slate-600">
          League transactions and admin actions will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activities.slice(0, 5).map((activity, index) => (
        <motion.div
          key={activity.id}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.05 }}
          className={`flex items-start gap-3 rounded-xl border px-3 py-3 transition-colors ${
            activity.urgent
              ? 'border-rose-200 bg-rose-50'
              : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
          }`}
        >
          {getActivityIcon(activity.type)}
          <div className="min-w-0 flex-1">
            <p
              className={`text-sm font-medium ${activity.urgent ? 'text-rose-900' : 'text-slate-900'}`}
            >
              {activity.message}
            </p>
            <p className="mt-1 text-xs text-slate-500">{formatTime(activity.timestamp)}</p>
          </div>
          {activity.urgent ? <div className="mt-1 h-2 w-2 rounded-full bg-rose-500"></div> : null}
        </motion.div>
      ))}

      {activities.length > 5 && (
        <Link
          href="/leagues"
          className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-center text-sm font-medium text-slate-700 transition hover:bg-white hover:text-slate-950"
        >
          Open all leagues
        </Link>
      )}
    </div>
  );
}
