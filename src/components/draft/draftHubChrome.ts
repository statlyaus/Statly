/** Shared visual chrome for public Draft hub pages (trades explorer, clubs, club detail). */
export const draftHubHeroShellClass =
  'relative overflow-hidden rounded-[1.75rem] border border-sky-500/20 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_30%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_24%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] p-5 shadow-[0_24px_80px_-40px_rgba(14,165,233,0.45)] md:p-6';

export const draftHubHeroTopAccentClass =
  'pointer-events-none absolute inset-x-0 top-0 h-1 bg-linear-to-r from-primary via-secondary to-primary';

/** Season / headline chips (e.g. `Season 2025`, trade counts, year span). */
export const draftHubSkyPillClass =
  'inline-flex shrink-0 items-center rounded-full border border-sky-200 bg-white/90 px-3 py-1 text-sm font-semibold text-sky-800 shadow-sm';

/** Compact chip for dense tables (trades count, years). */
export const draftHubSkyPillSmClass =
  'inline-flex shrink-0 items-center justify-center rounded-full border border-sky-200 bg-white/90 px-2.5 py-0.5 text-xs font-semibold text-sky-800 shadow-sm tabular-nums';

/** Neutral metric chip for dense layouts (e.g. assets count in tables). */
export const draftHubSlatePillSmClass =
  'inline-flex shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700 shadow-sm tabular-nums';
