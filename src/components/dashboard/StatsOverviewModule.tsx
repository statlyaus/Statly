import { motion } from 'framer-motion';

interface StatItem {
  label: string;
  value: string | number;
  change?: number;
  format?: 'number' | 'percentage' | 'currency';
}

interface StatsOverviewModuleProps {
  stats: StatItem[];
}

export default function StatsOverviewModule({
  stats,
}: StatsOverviewModuleProps) {
  const formatValue = (value: string | number, format?: StatItem['format']) => {
    if (typeof value === 'string') return value;

    switch (format) {
      case 'percentage':
        return `${value}%`;
      case 'currency':
        return `$${value.toLocaleString()}`;
      default:
        return value.toLocaleString();
    }
  };

  const formatChange = (change: number) => {
    const isPositive = change > 0;
    const prefix = isPositive ? '+' : '';
    return `${prefix}${change}%`;
  };

  const getChangeColor = (change: number) => {
    if (change > 0) return 'text-green-600';
    if (change < 0) return 'text-red-600';
    return 'text-slate-500';
  };

  const getChangeIcon = (change: number) => {
    if (change > 0) {
      return (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 17l9.2-9.2M17 17V7H7"
          />
        </svg>
      );
    }
    if (change < 0) {
      return (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 7l-9.2 9.2M7 7v10h10"
          />
        </svg>
      );
    }
    return (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
      </svg>
    );
  };

  if (stats.length === 0) {
    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg
            className="w-8 h-8 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        </div>
        <h4 className="font-medium text-slate-900 mb-1">No Stats Available</h4>
        <p className="text-sm text-slate-600">Statistics will appear here once available</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {stats.slice(0, 6).map((stat, index) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: index * 0.1 }}
          className="p-4 bg-slate-50 rounded-lg"
        >
          <div className="text-xs font-medium text-slate-600 uppercase tracking-wide mb-1">
            {stat.label}
          </div>
          <div className="text-2xl font-bold text-slate-900 mb-1">
            {formatValue(stat.value, stat.format)}
          </div>
          {stat.change !== undefined && (
            <div
              className={`flex items-center space-x-1 text-xs font-medium ${getChangeColor(stat.change)}`}
            >
              {getChangeIcon(stat.change)}
              <span>{formatChange(stat.change)}</span>
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}
