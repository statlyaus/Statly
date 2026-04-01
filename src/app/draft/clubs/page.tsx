import Link from 'next/link';

import { TeamLogo } from '@/components/TeamLogo';
import { listDraftClubs } from '@/lib/draftTrades/firestore';

export default async function DraftClubsPage() {
  const clubs = await listDraftClubs();

  return (
    <section className="space-y-5">
      <header className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
        <h2 className="text-xl font-semibold md:text-2xl">Club Trade Directory</h2>
        <p className="text-sm text-base-content/70">
          Browse AFL clubs and jump into each club&apos;s draft trade history.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {clubs.map((club) => (
          <Link
            key={`card-${club.clubSlug}`}
            href={`/draft/clubs/${club.clubSlug}`}
            className="group rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <TeamLogo team={club.clubName} size={20} withCircle />
                <h3 className="font-semibold group-hover:text-primary">{club.clubName}</h3>
              </div>
              <span className="badge badge-outline">{club.tradeCount} trades</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md border border-base-300 bg-base-200/40 p-2 text-center">
                <p className="text-base-content/60">Parties</p>
                <p className="font-semibold tabular-nums">{club.partyCount}</p>
              </div>
              <div className="rounded-md border border-base-300 bg-base-200/40 p-2 text-center">
                <p className="text-base-content/60">Assets</p>
                <p className="font-semibold tabular-nums">{club.assetCount}</p>
              </div>
              <div className="rounded-md border border-base-300 bg-base-200/40 p-2 text-center">
                <p className="text-base-content/60">Range</p>
                <p className="font-semibold tabular-nums">
                  {club.firstYear && club.lastYear ? `${club.firstYear}-${club.lastYear}` : '-'}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100 shadow-sm">
        <table className="table table-sm w-full">
          <thead>
            <tr>
              <th scope="col">Club</th>
              <th scope="col" className="text-right">
                Trades
              </th>
              <th scope="col" className="text-right">
                Parties
              </th>
              <th scope="col" className="text-right">
                Assets
              </th>
              <th scope="col" className="text-right">
                Range
              </th>
            </tr>
          </thead>
          <tbody>
            {clubs.map((club) => (
              <tr key={club.clubSlug} className="hover">
                <td>
                  <div className="flex items-center gap-2">
                    <TeamLogo team={club.clubName} size={16} withCircle />
                    <Link href={`/draft/clubs/${club.clubSlug}`} className="link link-hover font-medium">
                      {club.clubName}
                    </Link>
                  </div>
                </td>
                <td className="text-right tabular-nums">{club.tradeCount}</td>
                <td className="text-right tabular-nums">{club.partyCount}</td>
                <td className="text-right tabular-nums">{club.assetCount}</td>
                <td className="text-right tabular-nums">
                  {club.firstYear && club.lastYear ? `${club.firstYear}-${club.lastYear}` : '-'}
                </td>
              </tr>
            ))}
            {clubs.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-base-content/70">
                  No club trade data found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

