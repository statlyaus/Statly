import { DraftClubsDirectory } from '@/components/draft/DraftClubsDirectory';
import {
  draftHubHeroShellClass,
  draftHubHeroTopAccentClass,
} from '@/components/draft/draftHubChrome';
import { listDraftClubs } from '@/lib/draftTrades/firestore';

export default async function DraftClubsPage() {
  const clubs = await listDraftClubs();

  if (clubs.length === 0) {
    return (
      <section className="space-y-6" aria-labelledby="club-directory-heading">
        <header className={draftHubHeroShellClass}>
          <div className={draftHubHeroTopAccentClass} />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700/80">
            Club lens
          </p>
          <h2
            id="club-directory-heading"
            className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl"
          >
            Club trade directory
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">
            Browse AFL clubs and open each club&apos;s draft trade history.
          </p>
        </header>
        <div
          role="status"
          className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600 shadow-sm"
        >
          No club trade data found. Check back after trade records are imported.
        </div>
      </section>
    );
  }

  return <DraftClubsDirectory clubs={clubs} />;
}
