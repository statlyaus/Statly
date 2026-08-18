import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';
import {
  aflTradeIsoDateTimeSchema,
  aflTradePublicIdSchema,
} from '@/types/aflTradeIntelligence/shared';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeValuationViewContextSchema } from '../artifacts/valuationBundleManifest';
import { findAflTradeAssetCustodian } from '../domain/lineageAttribution';
import { isAflTradeKnownAt, parseAflTradeTime } from '../domain/lineageTemporal';
import type { AflTradeLineageGraph } from '../domain/lineageTypes';
import { validateAflTradeLineageGraph } from '../domain/lineageValidation';

const clubNameSchema = z.string().trim().min(1).max(120);

const valuationPartySchema = z
  .object({
    aflClubId: aflTradePublicIdSchema,
    clubName: clubNameSchema,
    receivedRootAssetIds: z.array(aflTradePublicIdSchema).min(1).max(100),
  })
  .strict();

export const aflTradeValuationCaseContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-valuation-case/v1'),
    publicAssetBoundary: z.literal('source_native_afl_assets_no_user_or_fantasy_ownership'),
    calculationUnit: z.literal('complete_multi_party_trade'),
    tradeId: aflTradePublicIdSchema,
    tradeEffectiveAt: aflTradeIsoDateTimeSchema,
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle').optional(),
    lineageGraphId: aflTradeContentAddressedIdSchema('lineage-graph'),
    componentDrawSetId: aflTradeContentAddressedIdSchema('component-draw-set'),
    realizedContributionLedgerId: aflTradeContentAddressedIdSchema('realized-contribution-ledger'),
    packagePolicyId: aflTradeContentAddressedIdSchema('package-policy'),
    valueUnitId: aflTradePublicIdSchema,
    parties: z.array(valuationPartySchema).min(2).max(18),
    viewContexts: z
      .array(aflTradeValuationViewContextSchema)
      .length(AFL_TRADE_VALUATION_VIEWS.length),
    legacySourceMetricsTreatment: z.literal(
      'excluded_from_calculation_retained_only_by_separate_legacy_projection'
    ),
  })
  .strict()
  .superRefine((valuationCase, context) => {
    const partyIds = valuationCase.parties.map((party) => party.aflClubId);
    if (new Set(partyIds).size !== partyIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['parties'],
        message: 'A valuation case must contain each receiving AFL club exactly once.',
      });
    }
    if (partyIds.some((partyId, index) => partyId !== [...partyIds].sort()[index])) {
      context.addIssue({
        code: 'custom',
        path: ['parties'],
        message: 'Valuation parties must use canonical AFL-club order.',
      });
    }

    const allRootAssetIds = valuationCase.parties.flatMap((party, partyIndex) => {
      if (
        party.receivedRootAssetIds.some(
          (assetId, index) => assetId !== [...party.receivedRootAssetIds].sort()[index]
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['parties', partyIndex, 'receivedRootAssetIds'],
          message: 'Received root assets must use canonical asset order.',
        });
      }
      return party.receivedRootAssetIds;
    });
    if (new Set(allRootAssetIds).size !== allRootAssetIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['parties'],
        message: 'A traded root asset may be received by only one AFL club.',
      });
    }

    const views = valuationCase.viewContexts.map((viewContext) => viewContext.view);
    if (
      views.some((view, index) => view !== AFL_TRADE_VALUATION_VIEWS[index]) ||
      new Set(views).size !== AFL_TRADE_VALUATION_VIEWS.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['viewContexts'],
        message: 'A valuation case must contain each valuation view in canonical order.',
      });
      return;
    }

    const atTradeContext = valuationCase.viewContexts[0];
    if (atTradeContext.effectiveAt !== valuationCase.tradeEffectiveAt) {
      context.addIssue({
        code: 'custom',
        path: ['viewContexts', 0, 'effectiveAt'],
        message: 'The at-trade effective time must equal the trade effective time.',
      });
    }
    if (Date.parse(atTradeContext.knowledgeCutoffAt) > Date.parse(atTradeContext.effectiveAt)) {
      context.addIssue({
        code: 'custom',
        path: ['viewContexts', 0, 'knowledgeCutoffAt'],
        message: 'At-trade valuation cannot use information learned after the trade.',
      });
    }
    const currentContexts = valuationCase.viewContexts.slice(1);
    const temporalKeys = currentContexts.map(
      ({ effectiveAt, knowledgeCutoffAt, valuationAsOf }) =>
        `${effectiveAt}|${knowledgeCutoffAt}|${valuationAsOf}`
    );
    if (new Set(temporalKeys).size !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['viewContexts'],
        message: 'Realized, remaining, and current views must share one temporal context.',
      });
    }
    if (
      currentContexts.some(
        (viewContext) =>
          Date.parse(viewContext.effectiveAt) < Date.parse(valuationCase.tradeEffectiveAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['viewContexts'],
        message: 'Current-view effective time cannot precede the trade.',
      });
    }
  });

export const aflTradeValuationCaseSchema = z
  .object({
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    content: aflTradeValuationCaseContentSchema,
  })
  .strict()
  .superRefine((valuationCase, context) => {
    addAflTradeContentAddressIssue(
      'valuation-case',
      valuationCase.valuationCaseId,
      valuationCase.content,
      context,
      ['valuationCaseId']
    );
  });

export type AflTradeValuationCaseContent = z.infer<typeof aflTradeValuationCaseContentSchema>;
export type AflTradeValuationCase = z.infer<typeof aflTradeValuationCaseSchema>;

export type AflTradeValuationCaseLineageIssueCode =
  | 'invalid_lineage_graph'
  | 'lineage_graph_id_mismatch'
  | 'unknown_root_asset'
  | 'root_not_visible_at_trade'
  | 'root_custody_mismatch'
  | 'related_trade_roots';

export interface AflTradeValuationCaseLineageIssue {
  code: AflTradeValuationCaseLineageIssueCode;
  assetId: string | null;
  message: string;
}

export interface AflTradeValuationCaseLineageValidation {
  valid: boolean;
  issues: AflTradeValuationCaseLineageIssue[];
}

function canonicalLineageGraph(graph: AflTradeLineageGraph) {
  return {
    assets: [...graph.assets].sort((left, right) => left.assetId.localeCompare(right.assetId)),
    custodySpells: [...graph.custodySpells].sort((left, right) =>
      left.custodySpellId.localeCompare(right.custodySpellId)
    ),
    edges: [...graph.edges].sort((left, right) => left.edgeId.localeCompare(right.edgeId)),
    dispositions: [...graph.dispositions].sort((left, right) =>
      left.dispositionId.localeCompare(right.dispositionId)
    ),
    corrections: [...graph.corrections].sort((left, right) =>
      left.correctionId.localeCompare(right.correctionId)
    ),
  };
}

export function createAflTradeLineageGraphId(graph: AflTradeLineageGraph): string {
  return createAflTradeContentAddress('lineage-graph', canonicalLineageGraph(graph));
}

function hasLineagePath(
  sourceAssetId: string,
  targetAssetId: string,
  outgoing: ReadonlyMap<string, readonly string[]>,
  visited = new Set<string>()
): boolean {
  if (sourceAssetId === targetAssetId) return true;
  if (visited.has(sourceAssetId)) return false;
  visited.add(sourceAssetId);
  return (outgoing.get(sourceAssetId) ?? []).some((nextAssetId) =>
    hasLineagePath(nextAssetId, targetAssetId, outgoing, visited)
  );
}

export function validateAflTradeValuationCaseLineage(
  unparsedValuationCase: AflTradeValuationCase,
  graph: AflTradeLineageGraph
): AflTradeValuationCaseLineageValidation {
  const valuationCase = aflTradeValuationCaseSchema.parse(unparsedValuationCase);
  const issues: AflTradeValuationCaseLineageIssue[] = [];
  const graphValidation = validateAflTradeLineageGraph(graph);
  if (!graphValidation.valid) {
    issues.push({
      code: 'invalid_lineage_graph',
      assetId: null,
      message: 'The valuation case requires a valid lineage graph.',
    });
  }
  if (createAflTradeLineageGraphId(graph) !== valuationCase.content.lineageGraphId) {
    issues.push({
      code: 'lineage_graph_id_mismatch',
      assetId: null,
      message: 'The lineage graph content does not match the valuation-case reference.',
    });
  }

  const atTrade = valuationCase.content.viewContexts[0];
  const effectiveAt = parseAflTradeTime(atTrade.effectiveAt);
  const knowledgeCutoff = parseAflTradeTime(atTrade.knowledgeCutoffAt);
  const assetById = new Map(graph.assets.map((asset) => [asset.assetId, asset]));
  const rootClubByAsset = new Map<string, string>();
  for (const party of valuationCase.content.parties) {
    for (const assetId of party.receivedRootAssetIds) {
      rootClubByAsset.set(assetId, party.aflClubId);
      const asset = assetById.get(assetId);
      if (!asset) {
        issues.push({
          code: 'unknown_root_asset',
          assetId,
          message: `Trade root ${assetId} is missing from the lineage graph.`,
        });
        continue;
      }
      const assetEffectiveFrom = parseAflTradeTime(asset.effectiveFrom);
      if (
        effectiveAt === null ||
        knowledgeCutoff === null ||
        assetEffectiveFrom === null ||
        assetEffectiveFrom > effectiveAt ||
        !isAflTradeKnownAt(asset, knowledgeCutoff)
      ) {
        issues.push({
          code: 'root_not_visible_at_trade',
          assetId,
          message: `Trade root ${assetId} was not effective and knowable at the trade cutoff.`,
        });
      }
      if (
        findAflTradeAssetCustodian(graph.custodySpells, assetId, {
          effectiveAsOf: atTrade.effectiveAt,
          knowledgeCutoffAt: atTrade.knowledgeCutoffAt,
        }) !== party.aflClubId
      ) {
        issues.push({
          code: 'root_custody_mismatch',
          assetId,
          message: `Trade root ${assetId} is not in the receiving AFL club's custody at the trade cutoff.`,
        });
      }
    }
  }

  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const targets = outgoing.get(edge.sourceAssetId) ?? [];
    targets.push(edge.targetAssetId);
    outgoing.set(edge.sourceAssetId, targets);
  }
  const rootAssetIds = [...rootClubByAsset.keys()].sort();
  for (let leftIndex = 0; leftIndex < rootAssetIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rootAssetIds.length; rightIndex += 1) {
      const left = rootAssetIds[leftIndex];
      const right = rootAssetIds[rightIndex];
      if (hasLineagePath(left, right, outgoing) || hasLineagePath(right, left, outgoing)) {
        issues.push({
          code: 'related_trade_roots',
          assetId: left,
          message: `Trade roots ${left} and ${right} cannot be ancestor and descendant.`,
        });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

export function createAflTradeValuationCase(
  unparsedContent: AflTradeValuationCaseContent
): AflTradeValuationCase {
  const content = aflTradeValuationCaseContentSchema.parse({
    ...unparsedContent,
    parties: [...unparsedContent.parties]
      .map((party) => ({
        ...party,
        receivedRootAssetIds: [...party.receivedRootAssetIds].sort(),
      }))
      .sort((left, right) => left.aflClubId.localeCompare(right.aflClubId)),
    viewContexts: [...unparsedContent.viewContexts].sort(
      (left, right) =>
        AFL_TRADE_VALUATION_VIEWS.indexOf(left.view) - AFL_TRADE_VALUATION_VIEWS.indexOf(right.view)
    ),
  });
  return aflTradeValuationCaseSchema.parse({
    valuationCaseId: createAflTradeContentAddress('valuation-case', content),
    content,
  });
}
