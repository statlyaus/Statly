import { FANTASY_CATEGORIES, formatStatValue } from '@/types/fantasyCategories';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';
import type { LeagueTradeDto } from '@/server/leagues/trades/tradeContracts';

export type TradeOfferAssetTone = 'outgoing' | 'incoming' | 'neutral';

interface TradeOfferAssetsProps {
  heading: string;
  teamName: string;
  players: LeagueTradeDto['currentOffer']['players'];
  playerStats: LeaguePlayerStatDatasetDto;
  tone: TradeOfferAssetTone;
}

const TONE_CLASSES: Record<TradeOfferAssetTone, string> = {
  outgoing:
    '[--trade-offer-direction:var(--trade-send)] [--trade-offer-direction-soft:var(--trade-send-soft)]',
  incoming:
    '[--trade-offer-direction:var(--trade-receive)] [--trade-offer-direction-soft:var(--trade-receive-soft)]',
  neutral:
    '[--trade-offer-direction:var(--trade-action)] [--trade-offer-direction-soft:var(--trade-action-soft)]',
};

export function TradeOfferAssets({
  heading,
  teamName,
  players,
  playerStats,
  tone,
}: TradeOfferAssetsProps): React.JSX.Element {
  return (
    <section
      aria-label={`${heading} package from ${teamName}`}
      className={`min-w-0 overflow-hidden rounded-lg border border-[color:var(--trade-border)] border-t-[3px] border-t-[color:var(--trade-offer-direction)] bg-[color:var(--trade-surface)] ${TONE_CLASSES[tone]}`}
    >
      <div className="border-b border-[color:var(--trade-border)] bg-[color:var(--trade-offer-direction-soft)] px-3 py-2.5">
        <h4 className="text-sm font-bold text-[color:var(--trade-text)]">{heading}</h4>
        <p className="mt-0.5 text-xs text-[color:var(--trade-text-muted)]">{teamName}</p>
      </div>

      {players.length === 0 ? (
        <p className="bg-[color:var(--trade-surface-subtle)] p-4 text-sm text-[color:var(--trade-text-muted)]">
          No players from this team
        </p>
      ) : (
        <div
          role="region"
          aria-label={`${teamName} player averages, horizontally scrollable`}
          className="overflow-x-auto focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[color:var(--trade-focus)]"
        >
          <table className="w-full min-w-max border-collapse text-left text-xs">
            <caption className="sr-only">
              Season {playerStats.context.season} per-game averages for {heading.toLowerCase()}.
            </caption>
            <thead className="bg-[color:var(--trade-surface-subtle)] text-[color:var(--trade-text-muted)]">
              <tr className="h-10 border-b border-[color:var(--trade-border-strong)]">
                <th
                  scope="col"
                  className="sticky left-0 z-10 min-w-48 bg-[color:var(--trade-surface-subtle)] px-3 py-2 font-bold"
                >
                  Player
                </th>
                {playerStats.columns.map((column) => (
                  <th key={column.key} scope="col" className="min-w-16 px-3 py-2 text-right">
                    <span aria-hidden="true">{column.shortLabel}</span>
                    <span className="sr-only">
                      {column.label}, {column.direction === 'LOW_WINS' ? 'lower' : 'higher'} is
                      better
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr
                  key={player.id}
                  className="h-12 border-b border-[color:var(--trade-border)] last:border-0 hover:bg-[color:var(--trade-action-soft)]"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-[color:var(--trade-surface)] px-3 py-2 text-sm font-semibold text-[color:var(--trade-text)]"
                  >
                    {player.name}
                    <span className="block text-xs font-normal text-[color:var(--trade-text-muted)]">
                      {[player.position, player.club].filter(Boolean).join(' · ')}
                    </span>
                  </th>
                  {playerStats.columns.map((column) => (
                    <td
                      key={column.key}
                      className="px-3 py-2 text-right text-[13px] font-medium tabular-nums text-[color:var(--trade-text)]"
                    >
                      {formatStatValue(
                        playerStats.playersById[player.id]?.values[column.key],
                        FANTASY_CATEGORIES[column.key]
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
