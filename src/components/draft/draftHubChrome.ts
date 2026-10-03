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
  'relative overflow-hidden rounded-lg border border-border bg-card p-5 md:p-6';

export const draftHubPageShellClass =
  'mx-auto w-full max-w-[var(--app-shell-max-width)] px-4 py-4 sm:px-6 md:py-6 lg:px-8 2xl:px-10';

export const draftHubHeaderShellClass =
  'relative overflow-hidden rounded-lg border border-border bg-card p-5 md:p-6';

export const draftHubHeaderKickerClass = 'text-xs font-semibold text-muted-foreground';

export const draftHubHeaderTitleClass =
  'mt-1 font-display text-3xl font-bold text-foreground md:text-4xl';

export const draftHubHeaderDescriptionClass =
  'mt-2 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base';

export const draftHubSectionPillClass =
  'inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground';

export const draftHubNavKickerClass = 'text-xs font-semibold text-muted-foreground';

export const draftHubSubtlePanelClass = 'rounded-lg border border-border bg-card';

/** Season / headline chips (e.g. `Season 2025`, trade counts, year span). */
export const draftHubSkyPillClass =
  'inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-background/90 px-3 py-1 text-sm font-semibold text-primary';

/** Compact chip for dense tables (trades count, years). */
export const draftHubSkyPillSmClass =
  'inline-flex shrink-0 items-center justify-center rounded-full border border-primary/20 bg-background/90 px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums';

/** Neutral metric chip for dense layouts (e.g. assets count in tables). */
export const draftHubSlatePillSmClass =
  'inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums';
