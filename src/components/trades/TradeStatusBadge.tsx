import type { ReactElement } from 'react';

import type { TradeStatus } from '@/components/trades/tradeApi';

function statusTone(status: TradeStatus) {
  switch (status) {
    case 'PROPOSED':
      return 'bg-warning text-warning ring-warning';
    case 'REVIEW_PENDING':
      return 'bg-info text-info ring-info';
    case 'EXECUTED':
      return 'bg-success text-success ring-success';
    case 'REVIEW_REJECTED':
      return 'bg-warning text-warning ring-warning';
    case 'DECLINED':
    case 'CANCELLED':
      return 'bg-destructive text-destructive ring-destructive';
    case 'SUPERSEDED':
    case 'EXPIRED':
      return 'bg-muted text-muted-foreground ring-ring';
    default:
      return 'bg-muted text-muted-foreground ring-ring';
  }
}

export function TradeStatusBadge({ status }: { status: TradeStatus }): ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ring-1 ring-inset ${statusTone(
        status
      )}`}
    >
      {status}
    </span>
  );
}
