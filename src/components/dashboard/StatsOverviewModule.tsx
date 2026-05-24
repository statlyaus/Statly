import { motion } from 'framer-motion';

interface StatItem {
  label: string;
  value: string | number;
  change?: number;
  format?: 'number' | 'percentage' | 'currency';
}

interface StatsOverviewModuleProps {
  stats: StatItem[];
  refreshTrigger: number;
}

export default function StatsOverviewModule({
  stats,
  refreshTrigger: _refreshTrigger,
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
    if (change > 0) return 'text-success';
    if (change < 0) return 'text-destructive';
    return 'text-muted-foreground';
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
      <div className="rounded-xl border border-dashed border-border bg-muted px-4 py-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white">
          <svg
            className="h-6 w-6 text-muted-foreground"
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
        <h4 className="text-sm font-semibold text-foreground">No account metrics yet</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Counts and timing signals will appear here once league data is available.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.slice(0, 6).map((stat, index) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: index * 0.1 }}
          className="rounded-xl border border-border bg-muted p-4"
        >
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {stat.label}
          </div>
          <div className="mb-1 text-2xl font-semibold text-foreground">
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
