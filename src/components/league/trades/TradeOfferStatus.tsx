import { AlertTriangle, CheckCircle2, CircleSlash2, Clock3, ShieldCheck } from 'lucide-react';

import type { LeagueTradeDto } from '@/server/leagues/trades/tradeContracts';

export const TRADE_STATUS_LABELS: Record<LeagueTradeDto['status'], string> = {
  PENDING: 'Awaiting response',
  ACCEPTED_PENDING_REVIEW: 'Accepted · review pending',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
  COMMISSIONER_REJECTED: 'Commissioner rejected',
  VETOED: 'Vetoed',
  EXPIRED: 'Expired',
  FAILED: 'Failed',
};

export function TradeOfferStatus({
  status,
}: {
  status: LeagueTradeDto['status'];
}): React.JSX.Element {
  const baseClasses =
    'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-bold';

  if (status === 'PENDING') {
    return (
      <span
        className={`${baseClasses} border-[color:var(--trade-warning)]/25 bg-[color:var(--trade-warning-soft)] text-[color:var(--trade-warning)]`}
      >
        <Clock3 aria-hidden="true" className="size-3.5" />
        {TRADE_STATUS_LABELS[status]}
      </span>
    );
  }
  if (status === 'ACCEPTED_PENDING_REVIEW') {
    return (
      <span
        className={`${baseClasses} border-[color:var(--trade-warning)]/25 bg-[color:var(--trade-warning-soft)] text-[color:var(--trade-warning)]`}
      >
        <ShieldCheck aria-hidden="true" className="size-3.5" />
        {TRADE_STATUS_LABELS[status]}
      </span>
    );
  }
  if (status === 'COMPLETED') {
    return (
      <span
        className={`${baseClasses} border-[color:var(--trade-brand)]/20 bg-[color:var(--trade-action-soft)] text-[color:var(--trade-brand)]`}
      >
        <CheckCircle2 aria-hidden="true" className="size-3.5" />
        {TRADE_STATUS_LABELS[status]}
      </span>
    );
  }
  if (status === 'FAILED') {
    return (
      <span
        className={`${baseClasses} border-[color:var(--trade-warning)]/25 bg-[color:var(--trade-warning-soft)] text-[color:var(--trade-warning)]`}
      >
        <AlertTriangle aria-hidden="true" className="size-3.5" />
        {TRADE_STATUS_LABELS[status]}
      </span>
    );
  }
  return (
    <span
      className={`${baseClasses} border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] text-[color:var(--trade-text-muted)]`}
    >
      <CircleSlash2 aria-hidden="true" className="size-3.5" />
      {TRADE_STATUS_LABELS[status]}
    </span>
  );
}
