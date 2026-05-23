/** Shared visual chrome for public Draft hub pages (trades explorer, clubs, club detail). */
export const draftHubClubLogoStripOrder: readonly string[] = [
  'Adelaide',
  'Brisbane',
  'Carlton',
  'Collingwood',
  'Essendon',
  'Fremantle',
  'Geelong',
  'Gold Coast',
  'GWS',
  'Hawthorn',
  'Melbourne',
  'North Melbourne',
  'Port Adelaide',
  'Richmond',
  'St Kilda',
  'Sydney',
  'West Coast',
  'Western Bulldogs',
];

export const draftHubHeroShellClass =
  'relative overflow-hidden rounded-[1.9rem] border border-primary/20 bg-card/95 p-5 shadow-xl shadow-primary/10 md:p-6';

export const draftHubHeroTopAccentClass =
  'pointer-events-none absolute inset-x-0 top-0 h-1 bg-linear-to-r from-primary via-secondary to-primary';

export const draftHubPageShellClass =
  'mx-auto w-full max-w-[var(--app-shell-max-width)] px-4 py-4 sm:px-6 md:py-6 lg:px-8 2xl:px-10';

export const draftHubHeaderShellClass =
  'relative overflow-hidden rounded-[2rem] border border-primary/20 bg-card/95 p-5 shadow-xl shadow-primary/10 md:p-6';

export const draftHubHeaderKickerClass =
  'text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/80';

export const draftHubHeaderTitleClass =
  'mt-2 text-2xl font-semibold tracking-tight text-foreground md:text-3xl';

export const draftHubHeaderDescriptionClass =
  'mt-2 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base';

export const draftHubSectionPillClass =
  'inline-flex items-center rounded-full border border-primary/20 bg-background/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary shadow-sm';

export const draftHubSubtlePanelClass = 'rounded-2xl border border-border bg-card/90 shadow-sm';

/** Season / headline chips (e.g. `Season 2025`, trade counts, year span). */
export const draftHubSkyPillClass =
  'inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-background/90 px-3 py-1 text-sm font-semibold text-primary shadow-sm';

/** Compact chip for dense tables (trades count, years). */
export const draftHubSkyPillSmClass =
  'inline-flex shrink-0 items-center justify-center rounded-full border border-primary/20 bg-background/90 px-2.5 py-0.5 text-xs font-semibold text-primary shadow-sm tabular-nums';

/** Neutral metric chip for dense layouts (e.g. assets count in tables). */
export const draftHubSlatePillSmClass =
  'inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground shadow-sm tabular-nums';
