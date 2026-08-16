import { z } from 'zod';

import {
  aflTradeIsoDateTimeSchema,
  aflTradePublicIdSchema,
} from '@/types/aflTradeIntelligence/shared';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  activeAflTradeEdgesBySource,
  isAflTradeKnownAt,
  parseAflTradeTime,
} from '../domain/lineageTemporal';
import type { AflTradeLineageGraph } from '../domain/lineageTypes';
import {
  aflTradeValuationCaseSchema,
  createAflTradeLineageGraphId,
  validateAflTradeValuationCaseLineage,
  type AflTradeValuationCase,
} from './valuationCaseContracts';

const finiteNumberSchema = z.number().finite();

const contributionRecordBase = {
  contributionRecordId: aflTradePublicIdSchema,
  rootAssetId: aflTradePublicIdSchema,
  contributorPlayerAssetId: aflTradePublicIdSchema,
  aflClubId: aflTradePublicIdSchema,
  custodySpellId: aflTradePublicIdSchema,
  periodStartAt: aflTradeIsoDateTimeSchema,
  periodEndAt: aflTradeIsoDateTimeSchema,
  knownFrom: aflTradeIsoDateTimeSchema,
  knownTo: aflTradeIsoDateTimeSchema.nullable(),
  evidenceId: aflTradePublicIdSchema,
  sourceObservationId: aflTradePublicIdSchema,
  contributionDefinitionId: aflTradePublicIdSchema,
  transformationVersion: aflTradePublicIdSchema,
};

const observedContributionRecordSchema = z
  .object({
    ...contributionRecordBase,
    state: z.literal('observed'),
    contribution: finiteNumberSchema,
  })
  .strict();

const unavailableContributionRecordSchema = z
  .object({
    ...contributionRecordBase,
    state: z.literal('unavailable'),
    reasonCode: aflTradePublicIdSchema,
    explanation: z.string().trim().min(1).max(500),
  })
  .strict();

export const aflTradeRealizedContributionRecordSchema = z
  .discriminatedUnion('state', [
    observedContributionRecordSchema,
    unavailableContributionRecordSchema,
  ])
  .superRefine((record, context) => {
    const periodStart = Date.parse(record.periodStartAt);
    const periodEnd = Date.parse(record.periodEndAt);
    const knownFrom = Date.parse(record.knownFrom);
    const knownTo = record.knownTo === null ? null : Date.parse(record.knownTo);
    if (periodEnd <= periodStart) {
      context.addIssue({
        code: 'custom',
        path: ['periodEndAt'],
        message: 'A contribution period must end after it starts.',
      });
    }
    if (knownFrom < periodEnd) {
      context.addIssue({
        code: 'custom',
        path: ['knownFrom'],
        message: 'Realized contribution cannot be known before its observation period ends.',
      });
    }
    if (knownTo !== null && knownTo <= knownFrom) {
      context.addIssue({
        code: 'custom',
        path: ['knownTo'],
        message: 'A contribution knowledge interval must end after it begins.',
      });
    }
  });

export const aflTradeRealizedContributionLedgerContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-realized-contribution-ledger/v1'),
    publicAssetBoundary: z.literal('source_native_afl_players_no_user_or_fantasy_ownership'),
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle').optional(),
    lineageGraphId: aflTradeContentAddressedIdSchema('lineage-graph'),
    valueUnitId: aflTradePublicIdSchema,
    records: z.array(aflTradeRealizedContributionRecordSchema).max(100_000),
    missingnessPolicy: z.literal('unavailable_is_explicit_and_never_coerced_to_zero'),
    contributionCreditPolicy: z.literal('receiving_afl_club_only_during_verified_custody'),
    limitation: z.literal(
      'Source-independent ledger contract only; records require lawfully approved evidence before any real valuation run.'
    ),
  })
  .strict()
  .superRefine((ledger, context) => {
    const recordIds = ledger.records.map((record) => record.contributionRecordId);
    if (
      new Set(recordIds).size !== recordIds.length ||
      recordIds.some((recordId, index) => recordId !== [...recordIds].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['records'],
        message: 'Contribution records must have unique canonical identities.',
      });
    }

    const sourceKeys = ledger.records.map(
      (record) =>
        `${record.rootAssetId}|${record.contributorPlayerAssetId}|${record.aflClubId}|${record.sourceObservationId}|${record.contributionDefinitionId}`
    );
    if (new Set(sourceKeys).size !== sourceKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['records'],
        message: 'A source observation may contribute to one ledger record only.',
      });
    }

    for (let leftIndex = 0; leftIndex < ledger.records.length; leftIndex += 1) {
      const left = ledger.records[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < ledger.records.length; rightIndex += 1) {
        const right = ledger.records[rightIndex];
        if (
          left.rootAssetId === right.rootAssetId &&
          left.contributorPlayerAssetId === right.contributorPlayerAssetId &&
          left.aflClubId === right.aflClubId &&
          left.contributionDefinitionId === right.contributionDefinitionId &&
          Date.parse(left.periodStartAt) < Date.parse(right.periodEndAt) &&
          Date.parse(right.periodStartAt) < Date.parse(left.periodEndAt)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['records', rightIndex],
            message:
              'Contribution periods cannot overlap within one root, player, club, and definition.',
          });
        }
      }
    }
  });

export const aflTradeRealizedContributionLedgerSchema = z
  .object({
    realizedContributionLedgerId: aflTradeContentAddressedIdSchema('realized-contribution-ledger'),
    content: aflTradeRealizedContributionLedgerContentSchema,
  })
  .strict()
  .superRefine((ledger, context) => {
    addAflTradeContentAddressIssue(
      'realized-contribution-ledger',
      ledger.realizedContributionLedgerId,
      ledger.content,
      context,
      ['realizedContributionLedgerId']
    );
  });

export type AflTradeRealizedContributionRecord = z.infer<
  typeof aflTradeRealizedContributionRecordSchema
>;
export type AflTradeRealizedContributionLedgerContent = z.infer<
  typeof aflTradeRealizedContributionLedgerContentSchema
>;
export type AflTradeRealizedContributionLedger = z.infer<
  typeof aflTradeRealizedContributionLedgerSchema
>;

export type AflTradeRealizedLedgerIssueCode =
  | 'case_reference_mismatch'
  | 'bundle_mismatch'
  | 'lineage_graph_mismatch'
  | 'value_unit_mismatch'
  | 'invalid_case_lineage'
  | 'unknown_root'
  | 'root_club_mismatch'
  | 'unknown_contributor'
  | 'contributor_not_player'
  | 'contributor_not_descendant'
  | 'unknown_custody_spell'
  | 'custody_asset_mismatch'
  | 'custody_club_mismatch'
  | 'contribution_outside_custody'
  | 'contribution_before_trade'
  | 'contribution_after_view_cutoff'
  | 'record_not_known_at_cutoff';

export interface AflTradeRealizedLedgerIssue {
  code: AflTradeRealizedLedgerIssueCode;
  contributionRecordId: string | null;
  message: string;
}

export interface AflTradeRealizedLedgerValidation {
  valid: boolean;
  issues: AflTradeRealizedLedgerIssue[];
}

function hasPath(
  sourceAssetId: string,
  targetAssetId: string,
  outgoing: ReadonlyMap<string, readonly { targetAssetId: string }[]>,
  visited = new Set<string>()
): boolean {
  if (sourceAssetId === targetAssetId) return true;
  if (visited.has(sourceAssetId)) return false;
  visited.add(sourceAssetId);
  return (outgoing.get(sourceAssetId) ?? []).some((edge) =>
    hasPath(edge.targetAssetId, targetAssetId, outgoing, visited)
  );
}

export function validateAflTradeRealizedContributionLedger(
  unparsedLedger: AflTradeRealizedContributionLedger,
  unparsedValuationCase: AflTradeValuationCase,
  graph: AflTradeLineageGraph
): AflTradeRealizedLedgerValidation {
  const ledger = aflTradeRealizedContributionLedgerSchema.parse(unparsedLedger);
  const valuationCase = aflTradeValuationCaseSchema.parse(unparsedValuationCase);
  const issues: AflTradeRealizedLedgerIssue[] = [];
  if (valuationCase.content.realizedContributionLedgerId !== ledger.realizedContributionLedgerId) {
    issues.push({
      code: 'case_reference_mismatch',
      contributionRecordId: null,
      message: 'The valuation case does not reference this realized-contribution ledger.',
    });
  }
  if (valuationCase.content.valuationBundleId !== ledger.content.valuationBundleId) {
    issues.push({
      code: 'bundle_mismatch',
      contributionRecordId: null,
      message: 'The valuation case and realized ledger must use the same valuation bundle.',
    });
  }
  if (
    valuationCase.content.lineageGraphId !== ledger.content.lineageGraphId ||
    createAflTradeLineageGraphId(graph) !== ledger.content.lineageGraphId
  ) {
    issues.push({
      code: 'lineage_graph_mismatch',
      contributionRecordId: null,
      message: 'The case, ledger, and supplied lineage graph must have one identity.',
    });
  }
  if (valuationCase.content.valueUnitId !== ledger.content.valueUnitId) {
    issues.push({
      code: 'value_unit_mismatch',
      contributionRecordId: null,
      message: 'Realized contribution must use the valuation case value unit.',
    });
  }
  if (!validateAflTradeValuationCaseLineage(valuationCase, graph).valid) {
    issues.push({
      code: 'invalid_case_lineage',
      contributionRecordId: null,
      message: 'Realized contribution requires a valid valuation-case lineage boundary.',
    });
  }

  const rootClubByAsset = new Map(
    valuationCase.content.parties.flatMap((party) =>
      party.receivedRootAssetIds.map((assetId) => [assetId, party.aflClubId] as const)
    )
  );
  const assetById = new Map(graph.assets.map((asset) => [asset.assetId, asset]));
  const custodyById = new Map(graph.custodySpells.map((spell) => [spell.custodySpellId, spell]));
  const currentContext = valuationCase.content.viewContexts.find(
    (viewContext) => viewContext.view === 'current'
  )!;
  const currentEffectiveAt = Date.parse(currentContext.effectiveAt);
  const currentKnowledgeCutoff = Date.parse(currentContext.knowledgeCutoffAt);
  const tradeEffectiveAt = Date.parse(valuationCase.content.tradeEffectiveAt);

  for (const record of ledger.content.records) {
    const recordId = record.contributionRecordId;
    const rootClub = rootClubByAsset.get(record.rootAssetId);
    if (!rootClub) {
      issues.push({
        code: 'unknown_root',
        contributionRecordId: recordId,
        message: `Contribution record ${recordId} does not reference a traded root.`,
      });
    } else if (rootClub !== record.aflClubId) {
      issues.push({
        code: 'root_club_mismatch',
        contributionRecordId: recordId,
        message: `Contribution record ${recordId} is not assigned to its receiving AFL club.`,
      });
    }

    const contributor = assetById.get(record.contributorPlayerAssetId);
    if (!contributor) {
      issues.push({
        code: 'unknown_contributor',
        contributionRecordId: recordId,
        message: `Contribution record ${recordId} references an unknown player asset.`,
      });
    } else if (contributor.assetType !== 'player') {
      issues.push({
        code: 'contributor_not_player',
        contributionRecordId: recordId,
        message: `Contribution record ${recordId} can be produced only by a player asset.`,
      });
    }

    const activeEdges = activeAflTradeEdgesBySource(graph.edges, {
      effectiveAsOf: record.periodEndAt,
      knowledgeCutoffAt: record.knownFrom,
    });
    if (!hasPath(record.rootAssetId, record.contributorPlayerAssetId, activeEdges)) {
      issues.push({
        code: 'contributor_not_descendant',
        contributionRecordId: recordId,
        message: `Contribution record ${recordId} is not on its traded root's lineage path.`,
      });
    }

    const custody = custodyById.get(record.custodySpellId);
    if (!custody) {
      issues.push({
        code: 'unknown_custody_spell',
        contributionRecordId: recordId,
        message: `Contribution record ${recordId} references an unknown custody spell.`,
      });
    } else {
      if (custody.assetId !== record.contributorPlayerAssetId) {
        issues.push({
          code: 'custody_asset_mismatch',
          contributionRecordId: recordId,
          message: `Contribution record ${recordId} custody does not belong to its player asset.`,
        });
      }
      if (custody.aflClubId !== record.aflClubId) {
        issues.push({
          code: 'custody_club_mismatch',
          contributionRecordId: recordId,
          message: `Contribution record ${recordId} custody belongs to another AFL club.`,
        });
      }
      const custodyStart = parseAflTradeTime(custody.effectiveFrom);
      const custodyEnd =
        custody.effectiveTo === null
          ? Number.POSITIVE_INFINITY
          : parseAflTradeTime(custody.effectiveTo);
      if (
        custodyStart === null ||
        custodyEnd === null ||
        Date.parse(record.periodStartAt) < custodyStart ||
        Date.parse(record.periodEndAt) > custodyEnd ||
        !isAflTradeKnownAt(custody, Date.parse(record.knownFrom))
      ) {
        issues.push({
          code: 'contribution_outside_custody',
          contributionRecordId: recordId,
          message: `Contribution record ${recordId} is not wholly inside verified AFL-club custody.`,
        });
      }
    }

    if (Date.parse(record.periodStartAt) < tradeEffectiveAt) {
      issues.push({
        code: 'contribution_before_trade',
        contributionRecordId: recordId,
        message: `Contribution record ${recordId} begins before the trade.`,
      });
    }
    if (Date.parse(record.periodEndAt) > currentEffectiveAt) {
      issues.push({
        code: 'contribution_after_view_cutoff',
        contributionRecordId: recordId,
        message: `Contribution record ${recordId} extends beyond the current effective cutoff.`,
      });
    }
    if (!isAflTradeKnownAt(record, currentKnowledgeCutoff)) {
      issues.push({
        code: 'record_not_known_at_cutoff',
        contributionRecordId: recordId,
        message: `Contribution record ${recordId} is not active at the current knowledge cutoff.`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

export function createAflTradeRealizedContributionLedger(
  unparsedContent: AflTradeRealizedContributionLedgerContent
): AflTradeRealizedContributionLedger {
  const content = aflTradeRealizedContributionLedgerContentSchema.parse({
    ...unparsedContent,
    records: [...unparsedContent.records].sort((left, right) =>
      left.contributionRecordId.localeCompare(right.contributionRecordId)
    ),
  });
  return aflTradeRealizedContributionLedgerSchema.parse({
    realizedContributionLedgerId: createAflTradeContentAddress(
      'realized-contribution-ledger',
      content
    ),
    content,
  });
}
