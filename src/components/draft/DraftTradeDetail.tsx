import Link from 'next/link';

import { DraftTeamLogo } from '@/components/draft/DraftHubState';

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

/**
 * Some feeds store the receiving column as e.g. "Essendon receives". Strip that suffix so we
 * do not render "Essendon receives receives" in card titles.
 */
function stripTrailingReceivesLabel(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const stripped = t.replace(/\s+receives\s*$/i, '').trim();
  return stripped.length > 0 ? stripped : t;
}

function groupAssetsByClub(
  assets: DraftTradeAssetView[]
): Array<{ displayClubName: string; assets: DraftTradeAssetView[] }> {
  const grouped = new Map<string, DraftTradeAssetView[]>();
  for (const asset of assets) {
    const raw = asset.clubName || 'Unknown';
    const displayClubName = stripTrailingReceivesLabel(raw);
    const mergeKey = displayClubName.toLowerCase() || 'unknown';
    const existing = grouped.get(mergeKey) ?? [];
    existing.push(asset);
    grouped.set(mergeKey, existing);
  }
  return Array.from(grouped.entries()).map(([, groupedAssets]) => {
    const firstRaw = groupedAssets[0]?.clubName || 'Unknown';
    return {
      displayClubName: stripTrailingReceivesLabel(firstRaw),
      assets: groupedAssets.slice().sort((a, b) => a.assetIndex - b.assetIndex),
    };
  });
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

/** Same height for every block: avoids one section reading as “selected”. */
function TradeModuleAccent({ tone }: { tone: 'summary' | 'parties' | 'receives' }) {
  const gradient =
    tone === 'summary'
      ? 'bg-linear-to-r from-primary/70 via-secondary/60 to-primary/70'
      : tone === 'parties'
        ? 'bg-linear-to-r from-base-content/28 via-base-content/12 to-base-content/28'
        : 'bg-linear-to-r from-secondary/55 via-secondary/30 to-secondary/55';

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-0 z-1 h-0.5 ${gradient}`}
      aria-hidden="true"
    />
  );
}

function TradeModuleHeader({
  step,
  eyebrow,
  titleId,
  title,
  description,
  pad,
  eyebrowClass,
  isInline,
  titleAs = 'section',
}: {
  step: 1 | 2 | 3;
  eyebrow: string;
  /** Required when `titleAs` is `section` (Parties / Receives). */
  titleId?: string;
  title: string;
  description: string;
  pad: string;
  eyebrowClass: string;
  isInline: boolean;
  /** `lead` = styled paragraph (Summary); keeps a single h2 for the trade title below. */
  titleAs?: 'section' | 'lead';
}) {
  const titleClass = `mt-1 font-semibold text-base-content ${isInline ? 'text-base' : 'text-lg'}`;

  return (
    <div className={`flex gap-3 border-b border-base-300 bg-base-200/50 ${pad}`}>
      <div className="flex shrink-0 flex-col pt-0.5" aria-hidden="true">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-base-300 bg-base-100 text-sm font-bold tabular-nums text-base-content/80 shadow-sm">
          {step}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className={eyebrowClass}>{eyebrow}</p>
        {titleAs === 'section' ? (
          <h3 id={titleId} className={titleClass}>
            {title}
          </h3>
        ) : (
          <p className={`${titleClass} text-base-content/90`}>{title}</p>
        )}
        <p className="mt-1 text-sm leading-relaxed text-base-content/65">{description}</p>
      </div>
    </div>
  );
}

export function DraftTradeDetail({
  detail,
  showOpenFullPageLink = false,
  mode = 'full',
}: DraftTradeDetailProps) {
  const groupedAssets = groupAssetsByClub(detail.assets);
  const playerAssetCount = detail.assets.filter((asset) => asset.assetType === 'player').length;
  const pickAssetCount = detail.assets.filter((asset) => asset.assetType === 'pick').length;
  const futurePickAssetCount = detail.assets.filter(
    (asset) => asset.assetType === 'future_pick'
  ).length;
  const isInline = mode === 'inline';
  const summaryTiles = [
    { label: 'Players', value: playerAssetCount, className: 'bg-success/8 ring-1 ring-success/15' },
    { label: 'Picks', value: pickAssetCount, className: 'bg-info/8 ring-1 ring-info/15' },
    {
      label: 'Future',
      value: futurePickAssetCount,
      className: 'bg-warning/8 ring-1 ring-warning/15',
    },
  ];

  const sectionHeaderPad = isInline ? 'px-4 py-3' : 'px-5 py-3.5';
  const sectionEyebrow = 'text-xs font-semibold uppercase tracking-[0.14em]';
  const partyTablePad = isInline
    ? '[&_th]:px-4 [&_td]:px-4 [&_th]:py-3 [&_td]:py-3'
    : '[&_th]:px-5 [&_td]:px-5 [&_th]:py-3.5 [&_td]:py-3.5';

  return (
    <div className={isInline ? 'space-y-4' : 'space-y-6'}>
      {/* Summary: neutral module — headline identity + counts (ESPN-style “card header + body”) */}
      <section
        id="trade-detail-summary"
        aria-labelledby="trade-detail-heading"
        className="overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm"
      >
        <TradeModuleHeader
          step={1}
          eyebrow="Summary"
          titleAs="lead"
          title="Snapshot"
          description="Official trade title plus a quick count of players, picks, and future picks. Clubs are listed in Parties below."
          pad={sectionHeaderPad}
          eyebrowClass={`${sectionEyebrow} text-base-content/55`}
          isInline={isInline}
        />
        <div
          className={`relative bg-linear-to-b from-base-200/35 to-base-100 ${isInline ? 'p-3' : 'p-4'}`}
        >
          <TradeModuleAccent tone="summary" />
          <div className="space-y-4 pt-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h2
                    id="trade-detail-heading"
                    className={`${isInline ? 'text-lg' : 'text-xl'} font-semibold leading-snug text-base-content`}
                  >
                    {detail.trade.title}
                  </h2>
                  <span className="badge badge-outline badge-sm shrink-0 sm:badge-md">
                    #{detail.trade.seqInYear}
                  </span>
                  <span className="badge badge-primary badge-outline badge-sm shrink-0 sm:badge-md">
                    {detail.trade.year}
                  </span>
                </div>
                {detail.trade.clubNames.length > 0 && (
                  <div
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1"
                    role="list"
                    aria-label="Clubs in this trade"
                  >
                    {detail.trade.clubNames.map((name, i) => (
                      <div key={`${name}-${i}`} className="flex items-center gap-2" role="listitem">
                        <DraftTeamLogo
                          team={name}
                          size={isInline ? 22 : 26}
                          withCircle
                          decorative
                        />
                        <span className="text-sm font-medium text-base-content/90">{name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
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
            <div
              className="grid min-w-0 grid-cols-3 gap-2"
              role="group"
              aria-label="What moved in this trade"
            >
              {summaryTiles.map((tile) => (
                <div
                  key={tile.label}
                  className={`min-w-0 rounded-2xl px-2.5 py-2 shadow-sm sm:px-3 ${tile.className} ${isInline ? '' : 'sm:py-3'}`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-base-content/55 sm:text-xs sm:tracking-[0.14em]">
                    {tile.label}
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-base-content sm:mt-1 sm:text-2xl">
                    {tile.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Parties: same card language as Summary — sequential section, not a selected tab */}
      <section id="trade-detail-parties" aria-labelledby="trade-parties-heading">
        <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <TradeModuleHeader
            step={2}
            eyebrow="Parties"
            titleId="trade-parties-heading"
            title="Who was in the deal"
            description="Each row is one club side. Raw assets are shown as recorded in the source feed."
            pad={sectionHeaderPad}
            eyebrowClass={`${sectionEyebrow} text-base-content/55`}
            isInline={isInline}
          />
          <div className="bg-base-100 px-2 pb-2 pt-2 sm:px-3 sm:pb-3">
            <div className="relative overflow-hidden rounded-xl bg-base-100 shadow-sm ring-1 ring-base-200/50">
              <TradeModuleAccent tone="parties" />
              <div className="overflow-x-auto pt-2">
                <table
                  className={`table w-full table-fixed border-collapse text-base [&_thead]:whitespace-normal ${partyTablePad}`}
                >
                  <colgroup>
                    <col className={isInline ? 'w-38' : 'w-46'} />
                    <col />
                    <col className="w-22 sm:w-24" />
                    <col className="w-22 sm:w-24" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-base-200 bg-base-200/50 [&>th]:align-bottom [&>th]:text-sm [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-base-content/65">
                      <th scope="col" className="whitespace-nowrap text-left">
                        Club
                      </th>
                      <th scope="col" className="min-w-0 text-left">
                        Assets (raw)
                      </th>
                      <th scope="col" className="whitespace-nowrap text-right tabular-nums">
                        Expected
                      </th>
                      <th scope="col" className="whitespace-nowrap text-right tabular-nums">
                        Actual
                      </th>
                    </tr>
                  </thead>
                  <tbody className="[&>tr]:border-b [&>tr]:border-base-200/80 [&>tr:last-child]:border-b-0">
                    {detail.parties
                      .slice()
                      .sort((a, b) => a.rowOrder - b.rowOrder)
                      .map((party) => (
                        <tr key={party.id} className="transition-colors hover:bg-base-200/25">
                          <td className="align-top text-left text-base font-medium leading-snug">
                            <div className="flex items-start gap-2.5">
                              <DraftTeamLogo
                                team={party.clubName}
                                size={isInline ? 24 : 28}
                                withCircle
                                decorative
                                className="mt-0.5"
                              />
                              <span className="min-w-0">{party.clubName}</span>
                            </div>
                          </td>
                          <td className="wrap-break-word min-w-0 align-top whitespace-pre-wrap text-left text-base leading-relaxed text-base-content/90">
                            {party.assetsRaw}
                          </td>
                          <td className="align-top text-right text-base tabular-nums">
                            {party.expected ?? '—'}
                          </td>
                          <td className="align-top text-right text-base tabular-nums">
                            {party.actual ?? '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Receives: same card language — part three of the same story */}
      <section id="trade-detail-receives" aria-labelledby="trade-receives-heading">
        <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <TradeModuleHeader
            step={3}
            eyebrow="Club receives"
            titleId="trade-receives-heading"
            title="What each club gained"
            description="Structured view: assets grouped by club, then by players, picks, and future picks."
            pad={sectionHeaderPad}
            eyebrowClass={`${sectionEyebrow} text-base-content/55`}
            isInline={isInline}
          />
          <div className={`relative bg-base-100 ${isInline ? 'p-3' : 'p-4'}`}>
            <TradeModuleAccent tone="receives" />
            <div className={`grid pt-2 lg:grid-cols-2 ${isInline ? 'gap-4' : 'gap-5'}`}>
              {groupedAssets.map((group) => (
                <article
                  key={`${detail.trade.tradeId}-${group.displayClubName}`}
                  className={`rounded-xl border border-base-200 bg-base-100 ${isInline ? 'p-3' : 'p-4'}`}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-base-200 pb-3">
                    <h4 className="flex min-w-0 items-center gap-2.5 text-base font-semibold text-base-content sm:text-lg">
                      <DraftTeamLogo
                        team={group.displayClubName}
                        size={isInline ? 28 : 32}
                        withCircle
                        decorative
                      />
                      <span className="min-w-0 leading-snug">
                        <span className="text-base-content">{group.displayClubName}</span>
                        <span className="font-normal text-base-content/80"> receives</span>
                      </span>
                    </h4>
                    <span className="text-sm tabular-nums text-base-content/60">
                      {group.assets.length} assets
                    </span>
                  </div>

                  {(() => {
                    const split = splitAssetsByType(group.assets);
                    const blocks = [
                      { key: 'players', label: 'Players', assets: split.players },
                      { key: 'picks', label: 'Picks', assets: split.picks },
                      { key: 'future-picks', label: 'Future picks', assets: split.futurePicks },
                      { key: 'other', label: 'Other', assets: split.other },
                    ].filter((block) => block.assets.length > 0);

                    return (
                      <div className={isInline ? 'space-y-3' : 'space-y-4'}>
                        {blocks.map((block) => (
                          <div key={block.key}>
                            <h5 className="text-xs font-semibold uppercase tracking-wide text-base-content/55 sm:text-sm">
                              {block.label}{' '}
                              <span className="font-normal text-base-content/45">
                                ({block.assets.length})
                              </span>
                            </h5>
                            <ul className="mt-2 divide-y divide-base-200 rounded-lg border border-base-200 bg-base-200/25">
                              {block.assets.map((asset) => (
                                <li
                                  key={asset.id}
                                  className="flex flex-col gap-1 px-3 py-2.5 sm:px-4 sm:py-3"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-sm font-medium text-base-content sm:text-base">
                                      {asset.assetText}
                                    </span>
                                    <span
                                      className={`badge badge-sm ${assetTypeBadgeClass(asset.assetType)}`}
                                    >
                                      {assetTypeLabel(asset.assetType)}
                                    </span>
                                  </div>
                                  <p className="text-sm leading-snug text-base-content/70">
                                    {asset.playerName ??
                                      asset.draftedPlayer ??
                                      'No player recorded'}
                                    {asset.games != null ? ` · ${asset.games} games` : ''}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
