import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AflDraftHistoryExplorer } from '@/components/draft/AflDraftHistoryExplorer';
import { DraftHubState } from '@/components/draft/DraftHubState';
import {
  AFL_DRAFT_HISTORY_DRAFT_KINDS,
  type AflDraftHistoryReadRequest,
} from '@/server/aflTradeIntelligence/outcomes/draftHistoryReadService';
import { getPublicAflTradeReadRuntime } from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function parseYear(value: string): number | null {
  if (!/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return year >= 1897 && year <= 2200 ? year : null;
}

function parseDraftKind(value: string | string[] | undefined) {
  const kind = first(value);
  return AFL_DRAFT_HISTORY_DRAFT_KINDS.find((candidate) => candidate === kind) ?? null;
}

function boundedText(value: string | string[] | undefined): string {
  return first(value).trim().slice(0, 160);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ year: string }>;
}): Promise<Metadata> {
  const { year } = await params;
  return {
    title: `${year} AFL Draft Selections & Pick History | Statly`,
    description: `Explore ${year} AFL draft selections, selecting and original clubs, resolved players, and released pick-trade lineage.`,
  };
}

export default async function AflDraftHistoryYearPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ year: rawYear }, resolvedSearch] = await Promise.all([params, searchParams]);
  const year = parseYear(rawYear);
  if (year === null) notFound();

  const rawDraftKind = first(resolvedSearch.draftKind);
  const query: AflDraftHistoryReadRequest = {
    year,
    q: boundedText(resolvedSearch.q),
    club: boundedText(resolvedSearch.club),
    draftKind: parseDraftKind(resolvedSearch.draftKind),
  };
  const filterNotice =
    rawDraftKind && !query.draftKind ? 'Unsupported draft filter ignored.' : null;

  try {
    const runtime = await getPublicAflTradeReadRuntime();
    const response = await runtime.draftHistoryReadService.readYear(query);
    return (
      <AflDraftHistoryExplorer response={response} query={query} filterNotice={filterNotice} />
    );
  } catch {
    return (
      <DraftHubState
        variant="error"
        title="Draft history could not be loaded"
        description="The reviewed draft-history release is temporarily unavailable. Retry this year to load the exact released selections."
        actionHref={`/draft/drafts/${year}`}
        actionLabel="Retry draft year"
      />
    );
  }
}
