import type { LeagueTradeDto, TradeActionName } from '@/server/leagues/trades/tradeContracts';

const ACTION_LABELS: Record<Exclude<TradeActionName, 'counter'>, string> = {
  accept: 'Accept',
  decline: 'Decline',
  withdraw: 'Withdraw',
  approve: 'Approve',
  reject: 'Reject',
  veto: 'Veto',
};

/** The decisions a manager can make on an offer, shown in the offer's header. */
export function TradeOfferActions({
  trade,
  title,
  isPending,
  onAction,
  onCounter,
}: {
  trade: LeagueTradeDto;
  title: string;
  isPending: boolean;
  onAction: (trade: LeagueTradeDto, action: Exclude<TradeActionName, 'counter'>) => void;
  onCounter: (trade: LeagueTradeDto) => void;
}): React.JSX.Element | null {
  if (trade.allowedActions.length === 0) return null;
  return (
    <div role="group" aria-label={`Actions for ${title}`} className="flex flex-wrap gap-2">
      {trade.allowedActions.map((action) =>
        action === 'counter' ? (
          <button
            key={action}
            type="button"
            disabled={isPending}
            onClick={() => onCounter(trade)}
            className={secondaryButtonClasses}
          >
            Counter
          </button>
        ) : (
          <button
            key={action}
            type="button"
            disabled={isPending}
            onClick={() => onAction(trade, action)}
            className={
              action === 'accept' || action === 'approve'
                ? primaryButtonClasses
                : secondaryButtonClasses
            }
          >
            {isPending ? 'Working…' : ACTION_LABELS[action]}
          </button>
        )
      )}
    </div>
  );
}

const primaryButtonClasses =
  'inline-flex h-11 items-center justify-center rounded-cut bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground transition-colors hover:bg-brand-bar-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
const secondaryButtonClasses =
  'inline-flex h-11 items-center justify-center rounded-cut border border-foreground bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
