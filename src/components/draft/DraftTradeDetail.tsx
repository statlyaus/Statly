import Link from 'next/link';
import { TeamLogo } from '@/components/TeamLogo';

export type DraftTradeHeaderView = {
  tradeId: string;
  year: number;
  seqInYear: number;
  title: string;
  clubNames: string[];
};

export type DraftTradePartyView = {
  id: string;
  clubName: string;
  assetsRaw: string;
  rowOrder: number;
  expected: number | null;
  actual: number | null;
};

export type DraftTradeAssetView = {
  id: string;
  assetIndex: number;
  clubName: string;
  assetType: 'player' | 'pick' | 'future_pick' | 'unknown';
  assetText: string;
  playerName: string | null;
  draftedPlayer: string | null;
  games: number | null;
};

export type DraftTradeDetailView = {
  trade: DraftTradeHeaderView;
  parties: DraftTradePartyView[];
  assets: DraftTradeAssetView[];
};

type DraftTradeDetailProps = {
  detail: DraftTradeDetailView;
  showOpenFullPageLink?: boolean;
  mode?: 'full' | 'inline';
};

function assetTypeLabel(assetType: DraftTradeAssetView['assetType']): string {
  if (assetType === 'future_pick') return 'Future Pick';
  if (assetType === 'pick') return 'Pick';
  if (assetType === 'player') return 'Player';
  return 'Other';
}

function assetTypeBadgeClass(assetType: DraftTradeAssetView['assetType']): string {
  if (assetType === 'player') {
    return 'badge-success badge-outline';
  }
  if (assetType === 'future_pick') {
    return 'badge-warning badge-outline';
  }
  if (assetType === 'pick') {
    return 'badge-info badge-outline';
  }
  return 'badge-ghost';
}

function assetSectionBadgeClass(sectionKey: string): string {
  if (sectionKey === 'players') return 'badge-success badge-outline';
  if (sectionKey === 'picks') return 'badge-info badge-outline';
  if (sectionKey === 'future-picks') return 'badge-warning badge-outline';
  return 'badge-ghost';
}

function assetCardClass(assetType: DraftTradeAssetView['assetType']): string {
  if (assetType === 'player') {
    return 'border-l-4 border-l-success';
  }
  if (assetType === 'future_pick') {
    return 'border-l-4 border-l-warning';
  }
  if (assetType === 'pick') {
    return 'border-l-4 border-l-info';
  }
  return '';
}

function groupAssetsByClub(assets: DraftTradeAssetView[]): Array<{ clubName: string; assets: DraftTradeAssetView[] }> {
  const grouped = new Map<string, DraftTradeAssetView[]>();
  for (const asset of assets) {
    const key = asset.clubName || 'Unknown';
    const existing = grouped.get(key) ?? [];
    existing.push(asset);
    grouped.set(key, existing);
  }
  return Array.from(grouped.entries()).map(([clubName, groupedAssets]) => ({
    clubName,
    assets: groupedAssets
      .slice()
      .sort((a, b) => a.assetIndex - b.assetIndex),
  }));
}

function splitAssetsByType(assets: DraftTradeAssetView[]): {
  players: DraftTradeAssetView[];
  picks: DraftTradeAssetView[];
  futurePicks: DraftTradeAssetView[];
  other: DraftTradeAssetView[];
} {
  const players: DraftTradeAssetView[] = [];
  const picks: DraftTradeAssetView[] = [];
  const futurePicks: DraftTradeAssetView[] = [];
  const other: DraftTradeAssetView[] = [];

  for (const asset of assets) {
    if (asset.assetType === 'player') {
      players.push(asset);
      continue;
    }
    if (asset.assetType === 'future_pick') {
      futurePicks.push(asset);
      continue;
    }
    if (asset.assetType === 'pick') {
      picks.push(asset);
      continue;
    }
    other.push(asset);
  }

  return { players, picks, futurePicks, other };
}

export function DraftTradeDetail({
  detail,
  showOpenFullPageLink = false,
  mode = 'full',
}: DraftTradeDetailProps) {
  const groupedAssets = groupAssetsByClub(detail.assets);
  const playerAssetCount = detail.assets.filter((asset) => asset.assetType === 'player').length;
  const pickAssetCount = detail.assets.filter((asset) => asset.assetType === 'pick').length;
  const futurePickAssetCount = detail.assets.filter((asset) => asset.assetType === 'future_pick').length;
  const isInline = mode === 'inline';
  const summaryTiles = [
    { label: 'Clubs', value: detail.trade.clubNames.length, className: 'border-base-300 bg-base-200/40' },
    { label: 'Parties', value: detail.parties.length, className: 'border-base-300 bg-base-200/40' },
    { label: 'Players', value: playerAssetCount, className: 'border-success/30 bg-success/10' },
    { label: 'Picks', value: pickAssetCount, className: 'border-info/30 bg-info/10' },
    { label: 'Future', value: futurePickAssetCount, className: 'border-warning/30 bg-warning/10' },
  ];

  return (
    <div className={isInline ? 'space-y-3' : 'space-y-5'}>
      <section className={`relative overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm ${isInline ? 'p-3' : 'p-4'}`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-linear-to-r from-primary/80 via-secondary/80 to-primary/80" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={`${isInline ? 'text-base' : 'text-lg'} font-semibold leading-tight`}>
                {detail.trade.title}
              </h2>
              <span className="badge badge-outline">#{detail.trade.seqInYear}</span>
              <span className="badge badge-primary badge-outline">{detail.trade.year}</span>
            </div>
            {detail.trade.clubNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {detail.trade.clubNames.map((clubName) => (
                  <span
                    key={`${detail.trade.tradeId}-${clubName}`}
                    className="inline-flex items-center gap-1 rounded-full border border-base-300 bg-base-100 px-2 py-1 text-xs"
                  >
                    <TeamLogo team={clubName} size={14} withCircle />
                    <span>{clubName}</span>
                  </span>
                ))}
              </div>
            )}
            <div className={`grid gap-1.5 ${isInline ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'}`}>
              {summaryTiles.map((tile) => (
                <div key={tile.label} className={`rounded-md border px-2 py-1 ${tile.className}`}>
                  <p className="text-[10px] uppercase tracking-wide text-base-content/65">{tile.label}</p>
                  <p className="text-sm font-semibold tabular-nums">{tile.value}</p>
                </div>
              ))}
              <div className="rounded-md border border-base-300 bg-base-200/40 px-2 py-1">
                <p className="text-[10px] uppercase tracking-wide text-base-content/65">Assets</p>
                <p className="text-sm font-semibold tabular-nums">{detail.assets.length}</p>
              </div>
            </div>
          </div>
          <div className={`flex items-center gap-2 ${isInline ? 'self-start' : ''}`}>
            <a
              href={`/api/draft-trades/${detail.trade.tradeId}/export`}
              className={`btn btn-outline ${isInline ? 'btn-xs' : 'btn-sm'}`}
            >
              Export CSV
            </a>
            {showOpenFullPageLink && (
              <Link
                href={`/draft/trades/${detail.trade.tradeId}`}
                className={`btn btn-outline ${isInline ? 'btn-xs' : 'btn-sm'}`}
              >
                Open full page
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className={isInline ? 'space-y-1.5' : 'space-y-2'}>
        <h3 className="border-l-4 border-primary/60 pl-2 text-sm font-semibold uppercase tracking-wide text-base-content/70">
          Parties
        </h3>
        <div className="overflow-x-auto rounded-xl border border-base-300">
          <table className="table table-xs w-full">
            <thead>
              <tr>
                <th scope="col">Club</th>
                <th scope="col">Assets (Raw)</th>
                <th scope="col" className="text-right">
                  Expected
                </th>
                <th scope="col" className="text-right">
                  Actual
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.parties
                .slice()
                .sort((a, b) => a.rowOrder - b.rowOrder)
                .slice(0, isInline ? 3 : detail.parties.length)
                .map((party) => (
                  <tr key={party.id} className="hover">
                    <td className="font-medium">{party.clubName}</td>
                    <td>{party.assetsRaw}</td>
                    <td className="text-right tabular-nums">{party.expected ?? '-'}</td>
                    <td className="text-right tabular-nums">{party.actual ?? '-'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {isInline && detail.parties.length > 3 && (
          <p className="text-xs text-base-content/60">
            Showing 3 of {detail.parties.length} parties. Open full page for complete breakdown.
          </p>
        )}
      </section>

      <section className={isInline ? 'space-y-2' : 'space-y-3'}>
        <h3 className="border-l-4 border-secondary/60 pl-2 text-sm font-semibold uppercase tracking-wide text-base-content/70">
          Club receive breakdown
        </h3>
        <p className="text-xs text-base-content/60">
          Assets grouped by club and then separated into players, picks, and future picks.
        </p>
        <div className={`grid ${isInline ? 'gap-2' : 'gap-3'} lg:grid-cols-2`}>
          {groupedAssets.map((group) => (
            <article
              key={`${detail.trade.tradeId}-${group.clubName}`}
              className={`rounded-xl border border-base-300 bg-base-100 shadow-sm ${isInline ? 'p-2.5' : 'p-3'}`}
            >
              <header className={`flex items-center justify-between gap-2 border-b border-base-300 ${isInline ? 'mb-1.5 pb-1.5' : 'mb-2 pb-2'}`}>
                <div className="flex items-center gap-2">
                  <TeamLogo team={group.clubName} size={isInline ? 16 : 18} withCircle />
                  <h4 className="text-sm font-semibold">{group.clubName} receives</h4>
                </div>
                <span className="badge badge-outline badge-sm">{group.assets.length} assets</span>
              </header>

              {(() => {
                const split = splitAssetsByType(group.assets);
                const sections: Array<{
                  key: string;
                  label: string;
                  assets: DraftTradeAssetView[];
                  sectionClass: string;
                }> = [
                  {
                    key: 'players',
                    label: 'Players',
                    assets: split.players,
                    sectionClass: 'border-success/30 bg-success/5',
                  },
                  {
                    key: 'picks',
                    label: 'Picks',
                    assets: split.picks,
                    sectionClass: 'border-info/30 bg-info/5',
                  },
                  {
                    key: 'future-picks',
                    label: 'Future Picks',
                    assets: split.futurePicks,
                    sectionClass: 'border-warning/30 bg-warning/5',
                  },
                  {
                    key: 'other',
                    label: 'Other',
                    assets: split.other,
                    sectionClass: 'border-base-300 bg-base-200/30',
                  },
                ];

                return (
                  <div className={isInline ? 'space-y-2' : 'space-y-3'}>
                    {sections
                      .filter((section) => section.assets.length > 0)
                      .map((section) => (
                        <section
                          key={section.key}
                          className={`rounded-lg border ${isInline ? 'p-1.5' : 'p-2'} ${section.sectionClass}`}
                        >
                          <div className={`${isInline ? 'mb-1' : 'mb-2'} flex items-center justify-between`}>
                            <span className={`badge badge-xs ${assetSectionBadgeClass(section.key)}`}>
                              {section.label}
                            </span>
                            <span className="text-xs text-base-content/60">
                              {section.assets.length}
                            </span>
                          </div>

                          <div className={isInline ? 'space-y-1.5' : 'space-y-2'}>
                            {section.assets
                              .slice(0, isInline ? 2 : section.assets.length)
                              .map((asset) => (
                                <div
                                  key={asset.id}
                                  className={`rounded-md border border-base-300 bg-base-100 ${isInline ? 'p-1.5' : 'p-2'} ${assetCardClass(
                                    asset.assetType
                                  )}`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className={`${isInline ? 'text-xs' : 'text-sm'} font-medium`}>
                                      {asset.assetText}
                                    </span>
                                    <span className={`badge badge-xs ${assetTypeBadgeClass(asset.assetType)}`}>
                                      {assetTypeLabel(asset.assetType)}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-base-content/70">
                                    {asset.playerName ?? asset.draftedPlayer ?? 'No player recorded'}
                                    {asset.games != null ? ` • ${asset.games} games` : ''}
                                  </p>
                                </div>
                              ))}
                          </div>
                          {isInline && section.assets.length > 2 && (
                            <p className="mt-2 text-xs text-base-content/60">
                              +{section.assets.length - 2} more {section.label.toLowerCase()} (open full page)
                            </p>
                          )}
                        </section>
                      ))}
                  </div>
                );
              })()}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
