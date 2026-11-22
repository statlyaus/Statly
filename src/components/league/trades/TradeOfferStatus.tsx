import type { LeagueTradeDto } from '@/server/leagues/trades/tradeContracts';

export const TRADE_STATUS_LABELS: Record<LeagueTradeDto['status'], string> = {
  PENDING: 'Pending',
  ACCEPTED_PENDING_REVIEW: 'Accepted · in review',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
  COMMISSIONER_REJECTED: 'Rejected',
  VETOED: 'Vetoed',
  EXPIRED: 'Expired',
  FAILED: 'Failed',
};

/** Status dot colour. The label always carries the meaning; the dot only reinforces it. */
const STATUS_DOT: Record<LeagueTradeDto['status'], string> = {
  PENDING: 'bg-warning-text',
  ACCEPTED_PENDING_REVIEW: 'bg-warning-text',
  COMPLETED: 'bg-success',
  DECLINED: 'bg-muted-foreground',
  WITHDRAWN: 'bg-muted-foreground',
  COMMISSIONER_REJECTED: 'bg-destructive',
  VETOED: 'bg-destructive',
  EXPIRED: 'bg-muted-foreground',
  FAILED: 'bg-destructive',
};

export function TradeOfferStatus({
  status,
}: {
  status: LeagueTradeDto['status'];
}): React.JSX.Element {
  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1.5 text-xs font-semibold text-foreground">
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
      {TRADE_STATUS_LABELS[status]}
    </span>
  );
}
