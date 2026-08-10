import type { Metadata } from 'next';

import { AflDraftTradeOutcomesExplorer } from '@/components/draft/AflDraftTradeOutcomesExplorer';
import {
  AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
  AflDraftTradeOutcomeReadError,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import { getPublicAflTradeReadRuntime } from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';
import {
  AFL_DRAFT_TRADE_OUTCOME_CHECK_STATUSES,
  AFL_DRAFT_TRADE_OUTCOME_METRICS,
  type AflDraftTradeOutcomeCheckStatus,
  type AflDraftTradeOutcomeListResponse,
  type AflDraftTradeOutcomeMetric,
} from '@/types/aflDraftTradeOutcomes';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AFL Draft & Trade Outcome Checks | Statly',
  description:
    'Check games, goals, coaches votes, Brownlow votes, awards, source coverage, and reconciliation status for reviewed AFL draft and trade outcomes.',
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function boundedText(value: string | string[] | undefined): string {
  return first(value).trim().slice(0, 160);
}

function parseYear(value: string | string[] | undefined): number | null {
  const raw = first(value);
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= 1897 && year <= 2200 ? year : null;
}

function parseMetric(value: string | string[] | undefined): AflDraftTradeOutcomeMetric | null {
  const raw = first(value) as AflDraftTradeOutcomeMetric;
  return AFL_DRAFT_TRADE_OUTCOME_METRICS.includes(raw) ? raw : null;
}

function parseStatus(value: string | string[] | undefined): AflDraftTradeOutcomeCheckStatus | null {
  const raw = first(value) as AflDraftTradeOutcomeCheckStatus;
  return AFL_DRAFT_TRADE_OUTCOME_CHECK_STATUSES.includes(raw) ? raw : null;
}

function parseCursor(value: string | string[] | undefined): string | null {
  const raw = first(value).trim();
  return raw.length > 0 && raw.length <= 1000 ? raw : null;
}

export default async function AflDraftTradeOutcomesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolved = await searchParams;
  let query = {
    year: parseYear(resolved.year),
    club: boundedText(resolved.club),
    q: boundedText(resolved.q),
    metric: parseMetric(resolved.metric),
    status: parseStatus(resolved.status),
    cursor: parseCursor(resolved.cursor),
  };
  let filterNotice: string | null = null;
  let response: AflDraftTradeOutcomeListResponse;
  const { outcomeReadService } = await getPublicAflTradeReadRuntime();
  try {
    response = await outcomeReadService.list({
      scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
      ...query,
      limit: 25,
    });
  } catch (error) {
    if (!(error instanceof AflDraftTradeOutcomeReadError) || error.code !== 'UNSUPPORTED_METRIC') {
      throw error;
    }
    const requestedMetric = query.metric?.replaceAll('_', ' ') ?? 'requested metric';
    filterNotice = `The active factual release does not include ${requestedMetric}. Showing all metrics supported by that release instead.`;
    query = { ...query, metric: null, cursor: null };
    response = await outcomeReadService.list({
      scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
      ...query,
      limit: 25,
    });
  }

  return (
    <AflDraftTradeOutcomesExplorer response={response} query={query} filterNotice={filterNotice} />
  );
}
