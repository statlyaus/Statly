import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TeamLogo } from '@/components/TeamLogo';
import { listDraftTradeRefsByClub } from '@/lib/draftTrades/firestore';

export default async function DraftClubDetailPage({
  params,
}: {
  params: Promise<{ clubSlug: string }>;
}) {
  const { clubSlug } = await params;
  const normalizedClubSlug = clubSlug.trim().toLowerCase();
  if (!normalizedClubSlug) {
    notFound();
  }

  const refs = await listDraftTradeRefsByClub(normalizedClubSlug);
  if (refs.length === 0) {
    notFound();
  }

  const clubName = refs[0]?.clubName ?? normalizedClubSlug;

  return (
    <section className="space-y-5">
      <header className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <TeamLogo team={clubName} size={28} withCircle />
            <div>
              <h2 className="text-xl font-semibold md:text-2xl">{clubName} Trade History</h2>
              <p className="text-sm text-base-content/70">
                Historical transactions involving {clubName}.
              </p>
            </div>
          </div>
          <a
            href={`/api/draft-trades/export?club=${encodeURIComponent(normalizedClubSlug)}&year=${refs[0]?.year ?? ''}`}
            className="btn btn-outline btn-sm"
          >
            Export Latest Year
          </a>
        </div>
        <p className="mt-2 text-sm text-base-content/70">
          {refs.length} trade references. Click a row to open full trade detail.
        </p>
      </header>

      <div className="space-y-3 md:hidden">
        {refs.map((ref) => (
          <article key={`card-${ref.tradeId}`} className="rounded-lg border border-base-300 bg-base-100 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="badge badge-outline">{ref.year}</span>
              <span className="badge badge-ghost">#{ref.seqInYear}</span>
            </div>
            <h3 className="mt-2 font-semibold leading-tight">
              <Link href={`/draft/trades/${ref.tradeId}`} className="link link-hover">
                {ref.title}
              </Link>
            </h3>
            <p className="mt-1 text-xs text-base-content/70">{ref.assetsRaw || 'No raw club return recorded.'}</p>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span>Expected: {ref.expected ?? '-'}</span>
              <span>Actual: {ref.actual ?? '-'}</span>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-base-300 bg-base-100 shadow-sm md:block">
        <table className="table table-sm w-full">
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col">#</th>
              <th scope="col">Trade</th>
              <th scope="col">Club Return (raw)</th>
              <th scope="col" className="text-right">
                Expected
              </th>
              <th scope="col" className="text-right">
                Actual
              </th>
            </tr>
          </thead>
          <tbody>
            {refs.map((ref) => (
              <tr key={ref.tradeId} className="hover">
                <td className="tabular-nums">{ref.year}</td>
                <td className="tabular-nums">{ref.seqInYear}</td>
                <td>
                  <Link href={`/draft/trades/${ref.tradeId}`} className="link link-hover font-medium">
                    {ref.title}
                  </Link>
                </td>
                <td>{ref.assetsRaw || '-'}</td>
                <td className="text-right tabular-nums">{ref.expected ?? '-'}</td>
                <td className="text-right tabular-nums">{ref.actual ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

