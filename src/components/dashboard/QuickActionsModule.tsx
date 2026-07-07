import Link from 'next/link';

import { motion } from 'framer-motion';

interface QuickActionsModuleProps {
  refreshTrigger: number;
}

export default function QuickActionsModule({
  refreshTrigger: _refreshTrigger,
}: QuickActionsModuleProps) {
  const actions = [
    {
      title: 'Create League',
      description: 'Start a new fantasy league',
      href: '/leagues/new',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      ),
      badge: 'Build',
    },
    {
      title: 'League directory',
      description: 'Open league workspaces from the dashboard',
      href: '/dashboard#leagues',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      ),
      badge: 'Manage',
    },
    {
      title: 'Waivers & Trades',
      description: 'Review claims, offers, and league movement',
      href: '/waivers',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
          />
        </svg>
      ),
      badge: 'Trade',
    },
    {
      title: 'Player Rankings',
      description: 'Research season leaders',
      href: '/rankings',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
          />
        </svg>
      ),
      badge: 'Scout',
    },
    {
      title: 'Live Scoring',
      description: 'Track current AFL scoring and player stat movement',
      href: '/live-scoring',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
      badge: 'Live',
    },
    {
      title: 'Draft room',
      description: 'Jump into active drafts',
      href: '/drafts',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
      ),
      badge: 'Draft',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {actions.map((action, index) => (
        <motion.div
          key={action.title}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: index * 0.1 }}
        >
          <Link
            href={action.href}
            className="block rounded-xl border border-border bg-muted p-4 transition hover:border-border hover:bg-white hover:shadow-sm group"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-white text-foreground transition group-hover:border-border group-hover:text-foreground">
                {action.icon}
              </div>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground ring-1 ring-inset ring-ring">
                {action.badge}
              </span>
            </div>
            <h4 className="mt-3 text-sm font-semibold text-foreground">{action.title}</h4>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{action.description}</p>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}
