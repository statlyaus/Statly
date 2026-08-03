import Link from 'next/link';

import type { AflTradeValueUnavailable } from '@/types/aflTradeIntelligence';

type AflTradeValueUnavailablePanelProps = {
  availability: AflTradeValueUnavailable;
  variant?: 'compact' | 'detail';
};

const availabilityLabels = {
  not_calculated: 'Trade value not calculated',
  source_blocked: 'Trade value unavailable',
  insufficient_data: 'Insufficient evidence',
  identity_unresolved: 'Player identity unresolved',
  lineage_unresolved: 'Asset lineage unresolved',
  model_not_approved: 'Model not approved',
  calculating: 'Calculation in progress',
  withdrawn: 'Trade value withdrawn',
  unsupported_trade: 'Trade value unsupported',
} as const satisfies Record<AflTradeValueUnavailable['availability'], string>;

const viewLabels = {
  at_trade: 'At-trade',
  realized: 'Realized outcome',
  remaining: 'Remaining outcome',
  current: 'Current outcome',
} as const satisfies Record<AflTradeValueUnavailable['view'], string>;

export function AflTradeValueUnavailablePanel({
  availability,
  variant = 'detail',
}: AflTradeValueUnavailablePanelProps) {
  const isCompact = variant === 'compact';
  const Heading = isCompact ? 'h2' : 'h3';
  const nextAction = availability.nextAction?.href
    ? {
        label: availability.nextAction.label,
        href: availability.nextAction.href,
      }
    : {
        label: 'Read methodology and current limits',
        href: availability.methodologyHref,
      };

  return (
    <section
      aria-label={`${viewLabels[availability.view]} trade value status`}
      data-afl-trade-value-availability={availability.availability}
      className={`rounded-2xl border border-border bg-card text-card-foreground shadow-sm ${
        isCompact ? 'p-4 md:p-5' : 'p-5 md:p-6'
      }`}
    >
      <div
        className={`flex gap-4 ${
          isCompact
            ? 'flex-col sm:flex-row sm:items-center sm:justify-between'
            : 'flex-col md:flex-row md:items-start md:justify-between'
        }`}
      >
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {viewLabels[availability.view]} view
            </span>
            <span className="text-xs font-medium text-muted-foreground">No numerical result</span>
          </div>
          <Heading
            className={`${isCompact ? 'mt-2 text-lg' : 'mt-3 text-xl'} font-semibold tracking-tight text-foreground`}
          >
            {availabilityLabels[availability.availability]}
          </Heading>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{availability.message}</p>
          {availability.warnings.length > 0 ? (
            <ul
              aria-label="Trade value availability warnings"
              className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground"
            >
              {availability.warnings.map((warning, index) => (
                <li
                  key={`${warning.code}-${index}`}
                  className="rounded-lg border border-border bg-muted p-3"
                >
                  {warning.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Link
          href={nextAction.href}
          className="inline-flex min-h-11 shrink-0 items-center justify-center self-start rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {nextAction.label}
        </Link>
      </div>
    </section>
  );
}
