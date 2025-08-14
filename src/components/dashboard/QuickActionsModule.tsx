import Link from 'next/link';
import { motion } from 'framer-motion';

interface QuickActionsModuleProps {
  refreshTrigger: number;
}

export default function QuickActionsModule({ refreshTrigger: _refreshTrigger }: QuickActionsModuleProps) {
  const actions = [
    {
      title: 'Create League',
      description: 'Start a new fantasy league',
      href: '/leagues/new',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
      color: 'bg-purple-500',
    },
    {
      title: 'Browse Leagues',
      description: 'Join existing leagues',
      href: '/leagues',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      ),
      color: 'bg-blue-500',
    },
    {
      title: 'Trade Centre',
      description: 'Manage trades',
      href: '/trade-centre',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      ),
      color: 'bg-green-500',
    },
    {
      title: 'Rankings',
      description: 'View player rankings',
      href: '/rankings',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      ),
      color: 'bg-yellow-500',
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
            className="block p-4 bg-white border border-slate-200 rounded-lg hover:shadow-md hover:border-slate-300 transition-all duration-200 group"
          >
            <div className={`w-10 h-10 ${action.color} rounded-lg flex items-center justify-center text-white mb-3 group-hover:scale-110 transition-transform`}>
              {action.icon}
            </div>
            <h4 className="font-medium text-slate-900 mb-1">{action.title}</h4>
            <p className="text-xs text-slate-600">{action.description}</p>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}
