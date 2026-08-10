import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflTradeExternalReconciliationCandidate } from './externalEvidenceReconciliation';

export const AFL_TRADE_WORKBOOK_SHADOW_DISPOSITION_SCHEMA_VERSION =
  'afl-trade-workbook-shadow-disposition/v1' as const;
export const AFL_TRADE_WORKBOOK_SHADOW_REPORT_SCHEMA_VERSION =
  'afl-trade-workbook-shadow-report/v1' as const;

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid UTC instant.');
const classificationSchema = z.enum([
  'approved_correction',
  'scope_or_coverage_difference',
  'parser_drift',
  'identity_ambiguity',
  'unresolved_lineage',
  'unexplained',
]);

const dispositionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_WORKBOOK_SHADOW_DISPOSITION_SCHEMA_VERSION),
    deltaKey: z.string().trim().min(1).max(500),
    classification: classificationSchema.exclude(['unexplained']),
    rationale: z.string().trim().min(1).max(2_000),
    reviewDecisionId: aflTradeContentAddressedIdSchema('review-decision'),
    reviewDecisionSha256: aflTradeSha256Schema,
    decidedAt: instantSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.reviewDecisionId !== `review-decision:${value.reviewDecisionSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['reviewDecisionId'],
        message: 'Review decision ID must bind the supplied digest.',
      });
    }
  });

const dispositionSchema = z
  .object({
    dispositionId: aflTradeContentAddressedIdSchema('workbook-shadow-disposition'),
    content: dispositionContentSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addAflTradeContentAddressIssue(
      'workbook-shadow-disposition',
      value.dispositionId,
      value.content,
      context,
      ['dispositionId']
    );
  });

export type AflTradeWorkbookShadowDisposition = z.infer<typeof dispositionSchema>;

export function createAflTradeWorkbookShadowDisposition(
  input: Omit<z.infer<typeof dispositionContentSchema>, 'schemaVersion'>
): AflTradeWorkbookShadowDisposition {
  const content = dispositionContentSchema.parse({
    ...input,
    schemaVersion: AFL_TRADE_WORKBOOK_SHADOW_DISPOSITION_SCHEMA_VERSION,
  });
  return dispositionSchema.parse({
    dispositionId: createAflTradeContentAddress('workbook-shadow-disposition', content),
    content,
  });
}

const transactionOracleSchema = z
  .object({
    oracleRowId: z.string().trim().min(1).max(500),
    kind: z.literal('transaction'),
    seasonYear: z.number().int().min(1988).max(2200),
    title: z.string().trim().min(1).max(500),
    parties: z.array(z.string().trim().min(1).max(240)).min(2).max(20),
  })
  .strict();
const selectionOracleSchema = z
  .object({
    oracleRowId: z.string().trim().min(1).max(500),
    kind: z.literal('draft_selection'),
    draftYear: z.number().int().min(1897).max(2200),
    draftType: z.enum(['national', 'rookie', 'pre_season', 'mid_season', 'mini_draft', 'other']),
    selectionNumber: z.number().int().positive().max(100_000),
    playerId: z.string().trim().min(1).max(240),
    clubId: z.string().trim().min(1).max(240),
  })
  .strict();
const oracleFactSchema = z.discriminatedUnion('kind', [
  transactionOracleSchema,
  selectionOracleSchema,
]);

type OracleFact = z.infer<typeof oracleFactSchema>;

interface ComparableFact {
  key: string;
  kind: OracleFact['kind'];
  sourceId: string;
  value: Readonly<Record<string, unknown>>;
}

function normalizedTitle(value: string): string {
  return value.toLocaleLowerCase('en-AU').replace(/\s+/g, ' ').trim();
}

function transactionKey(seasonYear: number, title: string): string {
  return `transaction|${seasonYear}|${normalizedTitle(title)}`;
}

function selectionKey(draftYear: number, draftType: string, selectionNumber: number): string {
  return `draft_selection|${draftYear}|${draftType}|${selectionNumber}`;
}

function canonicalValue(value: ComparableFact['value']): string {
  return JSON.stringify(value, Object.keys(value).sort());
}

function providerFacts(candidate: AflTradeExternalReconciliationCandidate): ComparableFact[] {
  return [
    ...candidate.content.transactions.map((transaction) => ({
      key: transactionKey(transaction.seasonYear, transaction.title ?? transaction.providerEventId),
      kind: 'transaction' as const,
      sourceId: transaction.transactionId,
      value: {
        parties: [...transaction.parties].sort(),
        title: normalizedTitle(transaction.title ?? transaction.providerEventId),
      },
    })),
    ...candidate.content.draftSelections.map((selection) => ({
      key: selectionKey(selection.draftYear, selection.draftType, selection.selectionNumber),
      kind: 'draft_selection' as const,
      sourceId: selection.selectionId,
      value: {
        clubId: selection.clubId,
        playerId: selection.playerId,
      },
    })),
  ];
}

function workbookFacts(oracleFacts: readonly OracleFact[]): ComparableFact[] {
  return oracleFacts.map((fact) =>
    fact.kind === 'transaction'
      ? {
          key: transactionKey(fact.seasonYear, fact.title),
          kind: fact.kind,
          sourceId: fact.oracleRowId,
          value: {
            parties: [...fact.parties].sort(),
            title: normalizedTitle(fact.title),
          },
        }
      : {
          key: selectionKey(fact.draftYear, fact.draftType, fact.selectionNumber),
          kind: fact.kind,
          sourceId: fact.oracleRowId,
          value: { clubId: fact.clubId, playerId: fact.playerId },
        }
  );
}

export function createAflTradeWorkbookShadowReport(input: {
  reconciliationCandidate: AflTradeExternalReconciliationCandidate;
  workbookStagingPackageId: string;
  oracleFacts: readonly unknown[];
  dispositions: readonly unknown[];
  comparedAt: string;
}) {
  const comparedAt = instantSchema.parse(input.comparedAt);
  aflTradeContentAddressedIdSchema('workbook-import').parse(input.workbookStagingPackageId);
  const expectedCandidateId = createAflTradeContentAddress(
    'external-reconciliation',
    input.reconciliationCandidate.content
  );
  if (input.reconciliationCandidate.candidateId !== expectedCandidateId) {
    throw new TypeError('External reconciliation candidate content address is invalid.');
  }
  const oracleFacts = input.oracleFacts.map((value) => oracleFactSchema.parse(value));
  const dispositions = input.dispositions.map((value) => dispositionSchema.parse(value));
  const dispositionByDelta = new Map<string, AflTradeWorkbookShadowDisposition>();
  dispositions.forEach((disposition) => {
    if (Date.parse(disposition.content.decidedAt) > Date.parse(comparedAt)) {
      throw new TypeError('Shadow disposition cannot be decided after the comparison.');
    }
    if (dispositionByDelta.has(disposition.content.deltaKey)) {
      throw new TypeError('Only one current disposition may classify a shadow delta.');
    }
    dispositionByDelta.set(disposition.content.deltaKey, disposition);
  });

  const providerByKey = new Map(
    providerFacts(input.reconciliationCandidate).map((fact) => [fact.key, fact])
  );
  const workbookByKey = new Map(workbookFacts(oracleFacts).map((fact) => [fact.key, fact]));
  const allKeys = [...new Set([...providerByKey.keys(), ...workbookByKey.keys()])].sort();
  const matches: Array<{ factKey: string; providerId: string; oracleRowId: string }> = [];
  const deltas = allKeys.flatMap((factKey) => {
    const provider = providerByKey.get(factKey);
    const workbook = workbookByKey.get(factKey);
    if (provider && workbook && canonicalValue(provider.value) === canonicalValue(workbook.value)) {
      matches.push({ factKey, providerId: provider.sourceId, oracleRowId: workbook.sourceId });
      return [];
    }
    const deltaKind = !provider ? 'workbook_only' : !workbook ? 'provider_only' : 'field_mismatch';
    const deltaKey = createAflTradeContentAddress('workbook-shadow-delta', {
      factKey,
      deltaKind,
      provider: provider?.value ?? null,
      workbook: workbook?.value ?? null,
    });
    const disposition = dispositionByDelta.get(deltaKey);
    return [
      {
        deltaKey,
        factKey,
        factKind: (provider ?? workbook)!.kind,
        deltaKind,
        providerId: provider?.sourceId ?? null,
        oracleRowId: workbook?.sourceId ?? null,
        providerValue: provider?.value ?? null,
        workbookValue: workbook?.value ?? null,
        classification: disposition?.content.classification ?? ('unexplained' as const),
        dispositionId: disposition?.dispositionId ?? null,
      },
    ];
  });
  const unexplained = deltas.filter((delta) => delta.classification === 'unexplained').length;
  const content = {
    schemaVersion: AFL_TRADE_WORKBOOK_SHADOW_REPORT_SCHEMA_VERSION,
    reconciliationCandidateId: input.reconciliationCandidate.candidateId,
    workbookStagingPackageId: input.workbookStagingPackageId,
    workbookAuthority: 'frozen_private_migration_oracle_only' as const,
    matches,
    deltas,
    dispositionIds: dispositions.map((value) => value.dispositionId).sort(),
    counts: { matched: matches.length, deltas: deltas.length, unexplained },
    readyForWorkbookRetirement:
      unexplained === 0 && input.reconciliationCandidate.content.issues.length === 0,
    comparedAt,
    publicationEligible: false as const,
  };
  return {
    reportId: createAflTradeContentAddress('workbook-shadow-report', content),
    content,
  };
}
