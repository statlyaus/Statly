import type {
  AflOutcomesDevelopmentGrade,
  AflOutcomesDevelopmentTradeGradeAsset,
  AflOutcomesDevelopmentTradeGradeEvidence,
  AflOutcomesDevelopmentTradeGradeReason,
} from '@/server/aflTradeIntelligence/source/developmentWorkbookTradeOutcomeProjection';

type Props = {
  evidence: AflOutcomesDevelopmentTradeGradeEvidence;
};

const reasonLabels: Readonly<Record<AflOutcomesDevelopmentTradeGradeReason, string>> = {
  future_pick_unresolved: 'Future pick has not been resolved through lineage.',
  draft_selection_not_recorded: 'No drafted player is recorded for this pick.',
  no_acquisition_match: 'No unique same-club acquisition row could be linked.',
  ambiguous_acquisition_match: 'More than one acquisition row could match this asset.',
  grade_not_recorded: 'The linked workbook row has no grade.',
  grade_not_recognized: 'The linked workbook row uses an unsupported grade label.',
};

function gradeClass(grade: AflOutcomesDevelopmentGrade): string {
  if (grade === 'A+' || grade === 'A') {
    return 'border-success/30 bg-success/10 text-success';
  }
  if (grade === 'B+' || grade === 'B') {
    return 'border-info/30 bg-info/10 text-info';
  }
  if (grade === 'C+' || grade === 'C') {
    return 'border-warning/35 bg-warning/10 text-warning';
  }
  return 'border-error/30 bg-error/10 text-error';
}

function displayMetric(value: string | null): string {
  return value === null ? 'Not recorded' : value;
}

function observedDate(value: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Melbourne',
  }).format(new Date(value));
}

function groupByClub(
  assets: readonly AflOutcomesDevelopmentTradeGradeAsset[]
): Array<{ clubSlug: string; clubName: string; assets: AflOutcomesDevelopmentTradeGradeAsset[] }> {
  const grouped = new Map<
    string,
    { clubSlug: string; clubName: string; assets: AflOutcomesDevelopmentTradeGradeAsset[] }
  >();
  for (const asset of assets) {
    const current = grouped.get(asset.clubSlug) ?? {
      clubSlug: asset.clubSlug,
      clubName: asset.clubName,
      assets: [],
    };
    current.assets.push(asset);
    grouped.set(asset.clubSlug, current);
  }
  return Array.from(grouped.values());
}

function AssetOutcome({ asset }: { asset: AflOutcomesDevelopmentTradeGradeAsset }) {
  if (asset.status === 'graded' && asset.outcome?.grade) {
    return (
      <li className="grid gap-3 px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
        <span
          className={`flex h-12 w-12 items-center justify-center rounded-xl border text-lg font-bold tabular-nums ${gradeClass(asset.outcome.grade)}`}
          aria-label={`Recorded grade ${asset.outcome.grade}`}
        >
          {asset.outcome.grade}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div>
              <p className="font-semibold text-foreground">{asset.outcome.playerName}</p>
              <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{asset.assetText}</p>
            </div>
            <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
              {asset.outcome.acquisitionType}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Games
              </dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                {displayMetric(asset.outcome.games)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Goals
              </dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                {displayMetric(asset.outcome.goals)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Coaches votes
              </dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                {displayMetric(asset.outcome.coachesVotes)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Brownlow votes
              </dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                {displayMetric(asset.outcome.brownlowVotes)}
              </dd>
            </div>
          </dl>
          {asset.outcome.awards ? (
            <p className="mt-3 text-sm leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">Awards:</span>{' '}
              {asset.outcome.awards}
            </p>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{asset.assetText}</p>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {asset.reasonCode ? reasonLabels[asset.reasonCode] : 'No recorded grade is available.'}
        </p>
      </div>
      <span className="w-fit shrink-0 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
        {asset.status === 'matched_without_grade' ? 'Not graded' : 'Not linked'}
      </span>
    </li>
  );
}

export function DevelopmentWorkbookTradeGradePanel({ evidence }: Props) {
  const clubGroups = groupByClub(evidence.assets);
  const coveragePercent = evidence.coverage.totalAssets === 0
    ? 0
    : Math.round((evidence.coverage.gradedAssets / evidence.coverage.totalAssets) * 100);

  return (
    <section
      aria-labelledby="development-workbook-grades-heading"
      className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm"
    >
      <div className="border-b border-border bg-muted/40 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Local development evidence
            </p>
            <h2
              id="development-workbook-grades-heading"
              className="mt-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl"
            >
              Recorded outcome grades
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              These are acquisition-level grades recorded in the pinned workbook. The workbook does
              not provide a grading formula or a whole-trade aggregation method, so Statly does not
              average them, name a winner, or treat them as an at-trade fairness verdict.
            </p>
          </div>
          <span className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground">
            Development only
          </span>
        </div>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Grade coverage
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">
              {evidence.coverage.gradedAssets} of {evidence.coverage.totalAssets}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{coveragePercent}% of recorded assets</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Unresolved
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">
              {evidence.coverage.unresolvedAssets}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Missing or non-unique acquisition links
            </p>
          </div>
          <div className="rounded-xl border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Workbook observed
            </p>
            <p className="mt-2 text-base font-bold text-foreground">
              {observedDate(evidence.source.observedAt)}
            </p>
            <p className="mt-1 truncate text-sm text-muted-foreground" title={evidence.source.originalFilename}>
              {evidence.source.originalFilename}
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {clubGroups.map((group) => (
            <article key={group.clubSlug} className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
                <h3 className="font-semibold text-foreground">{group.clubName} received</h3>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {group.assets.filter(({ status }) => status === 'graded').length}/
                  {group.assets.length} graded
                </span>
              </div>
              <ul className="divide-y divide-border bg-background">
                {group.assets.map((asset) => (
                  <AssetOutcome key={asset.assetId} asset={asset} />
                ))}
              </ul>
            </article>
          ))}
        </div>

        <p className="text-xs leading-5 text-muted-foreground">
          Grade scale recorded by the workbook: A+, A, B+, B, C+, C, D. Source grade methodology
          and calculation rules are not documented in the workbook.
        </p>
      </div>
    </section>
  );
}
