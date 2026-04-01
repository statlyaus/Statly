import type { ReactElement } from 'react';

import type { TradeStatus } from '@/components/trades/tradeApi';

function statusTone(status: TradeStatus) {
  switch (status) {
    case 'PROPOSED':
      return 'bg-amber-500/15 text-amber-300 ring-amber-400/30';
    case 'REVIEW_PENDING':
      return 'bg-sky-500/15 text-sky-300 ring-sky-400/30';
    case 'EXECUTED':
      return 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30';
    case 'REVIEW_REJECTED':
      return 'bg-orange-500/15 text-orange-300 ring-orange-400/30';
    case 'DECLINED':
    case 'CANCELLED':
      return 'bg-rose-500/15 text-rose-300 ring-rose-400/30';
    case 'SUPERSEDED':
    case 'EXPIRED':
      return 'bg-slate-500/15 text-slate-300 ring-slate-400/30';
    default:
      return 'bg-slate-500/15 text-slate-300 ring-slate-400/30';
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
