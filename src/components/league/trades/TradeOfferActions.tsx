import { buttonStyles } from '@/components/ui/controlStyles';
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
            className={buttonStyles()}
          >
            Counter
          </button>
        ) : (
          <button
            key={action}
            type="button"
            disabled={isPending}
            onClick={() => onAction(trade, action)}
            className={buttonStyles({
              variant: action === 'accept' || action === 'approve' ? 'primary' : 'outline',
            })}
          >
            {isPending ? 'Working…' : ACTION_LABELS[action]}
          </button>
        )
      )}
    </div>
  );
}
