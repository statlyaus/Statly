import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
} from '../artifacts/contentAddress';
import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import type { AflTradeDecisionEnvironment } from '../governance/gateDecisionTypes';
import {
  authenticateAflDraftTradeOutcomeReleaseRegistry,
  captureAflDraftTradeOutcomeReleaseSelection,
  type AflDraftTradeOutcomeReleaseRegistry,
} from './outcomeReleaseState';
import {
  createAflTradePromotionBackedGate2Admission,
  parseAflTradePromotionBackedGate2Admission,
} from './promotionBackedGate2AdmissionContracts';
import { parseAflTradePromotionBackedFactualLineage } from './promotionBackedFactualLineageContracts';
import { parseAflTradePromotionBackedFactualProjection } from './promotionBackedFactualProjectionContracts';
import { parseAflTradePromotionBackedFactualRelease } from './promotionBackedFactualReleaseContracts';

export const AFL_TRADE_PROMOTION_BACKED_ARCHIVE_SELECTION_SCHEMA_VERSION =
  'afl-trade-promotion-backed-archive-selection/v1' as const;

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .pipe(z.iso.datetime({ offset: true }));

export const aflTradePromotionBackedArchiveSelectionSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROMOTION_BACKED_ARCHIVE_SELECTION_SCHEMA_VERSION),
    registryRevision: z.number().int().positive(),
    scopeKey: z.string().trim().min(1).max(1_000),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.string().trim().min(1).max(40),
    validFromSeason: z.number().int().min(1897).max(2200),
    validThroughSeason: z.number().int().min(1897).max(2200),
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    projectionId: aflTradeContentAddressedIdSchema('outcome-projection'),
    publicArchiveId: aflTradeContentAddressedIdSchema('public-factual-archive'),
    factualCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    lineageId: aflTradeContentAddressedIdSchema('corpus-factual-lineage'),
    gate2AdmissionId: aflTradeContentAddressedIdSchema('corpus-factual-lineage-admission'),
    gate2DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    sourceMemberSetSha256: aflTradeSha256Schema,
    canonicalMemberSetSha256: aflTradeSha256Schema,
    publicRecordSetSha256: aflTradeSha256Schema,
    publicRecordCount: z.number().int().positive().max(1_000_000),
    effectiveThrough: instantSchema,
    publishedAt: instantSchema,
    capturedAt: instantSchema,
  })
  .strict()
  .superRefine((selection, context) => {
    if (
      selection.validThroughSeason < selection.validFromSeason ||
      Date.parse(selection.effectiveThrough) > Date.parse(selection.publishedAt) ||
      Date.parse(selection.publishedAt) > Date.parse(selection.capturedAt)
    ) {
      context.addIssue({ code: 'custom', message: 'Archive selection chronology is invalid.' });
    }
  });

export type AflTradePromotionBackedArchiveSelection = z.infer<
  typeof aflTradePromotionBackedArchiveSelectionSchema
>;

export interface AflTradePromotionBackedGate2Authority {
  readonly lineage: unknown;
  readonly admission: unknown;
}

export interface AflTradePromotionBackedArchiveSelectionSnapshot {
  readonly registryRevision: number;
  readonly selection: AflTradePromotionBackedArchiveSelection | null;
  readonly unavailabilityReason: 'no_active_release' | 'source_blocked' | 'gate2_blocked' | null;
}

export interface AflTradePromotionBackedArchiveSelector {
  capture(scopeKey: string): Promise<AflTradePromotionBackedArchiveSelectionSnapshot>;
}

function requireCurrentGate2(input: {
  authority: AflTradePromotionBackedGate2Authority;
  ledger: AflTradeGateDecisionLedger;
  evaluatedAt: string;
  releaseId: string;
  projectionCandidateId: string;
  projectionCorpusId: string;
  sourceMemberSetSha256: string;
  canonicalMemberSetSha256: string;
}) {
  const lineage = parseAflTradePromotionBackedFactualLineage(input.authority.lineage);
  const admission = parseAflTradePromotionBackedGate2Admission(input.authority.admission);
  if (
    lineage.content.factualReleaseId !== input.releaseId ||
    lineage.content.factualCandidateId !== input.projectionCandidateId ||
    lineage.content.corpusId !== input.projectionCorpusId ||
    lineage.content.sourceMemberSetSha256 !== input.sourceMemberSetSha256 ||
    lineage.content.canonicalMemberSetSha256 !== input.canonicalMemberSetSha256 ||
    admission.content.lineageId !== lineage.lineageId ||
    admission.content.factualReleaseId !== input.releaseId ||
    admission.content.factualCandidateId !== input.projectionCandidateId ||
    admission.content.corpusId !== input.projectionCorpusId
  ) {
    throw new TypeError('Gate 2 authority does not match the exact active factual ancestry.');
  }

  const current = createAflTradePromotionBackedGate2Admission({
    lineage,
    ledger: input.ledger,
    ledgerRevision: input.ledger.decisions.length,
    evaluatedAt: input.evaluatedAt,
  });
  if (
    current.content.gate2DecisionId !== admission.content.gate2DecisionId ||
    current.content.gate2ProposalId !== admission.content.gate2ProposalId ||
    current.content.gate2DecisionKey !== admission.content.gate2DecisionKey
  ) {
    throw new TypeError('The stored Gate 2 admission is no longer current.');
  }
  return { lineage, admission };
}

export function createAflTradePromotionBackedArchiveSelector(dependencies: {
  loadRegistry: () => Promise<AflDraftTradeOutcomeReleaseRegistry>;
  loadGateDecisionLedger: () => Promise<AflTradeGateDecisionLedger>;
  loadGate2Authority: (releaseId: string) => Promise<AflTradePromotionBackedGate2Authority | null>;
  expectedEnvironment: AflTradeDecisionEnvironment;
  now?: () => string;
}): AflTradePromotionBackedArchiveSelector {
  const now = dependencies.now ?? (() => new Date().toISOString());
  return {
    async capture(scopeKey) {
      const [rawRegistry, ledger] = await Promise.all([
        dependencies.loadRegistry(),
        dependencies.loadGateDecisionLedger(),
      ]);
      const registry = authenticateAflDraftTradeOutcomeReleaseRegistry(rawRegistry);
      const evaluatedAt = now();
      const pointer = registry.activeByScope[scopeKey];
      if (!pointer) {
        return {
          registryRevision: registry.revision,
          selection: null,
          unavailabilityReason: 'no_active_release',
        };
      }
      const record = registry.releases[pointer.releaseId];
      if (
        !record ||
        record.scopeKey !== scopeKey ||
        record.state !== 'published' ||
        record.projectionManifest === null
      ) {
        throw new TypeError('The active archive pointer does not resolve to a published release.');
      }

      const rights = captureAflDraftTradeOutcomeReleaseSelection(registry, scopeKey, {
        evaluatedAt,
        sourceRightsDecisionLedger: ledger,
      });
      if (rights.unavailabilityReason === 'source_blocked') {
        return {
          registryRevision: registry.revision,
          selection: null,
          unavailabilityReason: 'source_blocked',
        };
      }

      const release = parseAflTradePromotionBackedFactualRelease(record.releaseManifest);
      const projection = parseAflTradePromotionBackedFactualProjection(record.projectionManifest);
      if (
        release.content.environment !== dependencies.expectedEnvironment ||
        projection.content.environment !== dependencies.expectedEnvironment
      ) {
        throw new TypeError(
          'The active archive release does not match the configured environment.'
        );
      }
      const authority = await dependencies.loadGate2Authority(release.releaseId);
      if (authority === null) {
        return {
          registryRevision: registry.revision,
          selection: null,
          unavailabilityReason: 'gate2_blocked',
        };
      }
      let currentGate2: ReturnType<typeof requireCurrentGate2>;
      try {
        currentGate2 = requireCurrentGate2({
          authority,
          ledger,
          evaluatedAt,
          releaseId: release.releaseId,
          projectionCandidateId: projection.content.factualCandidateId,
          projectionCorpusId: projection.content.corpusId,
          sourceMemberSetSha256: projection.content.sourceMemberSetSha256,
          canonicalMemberSetSha256: projection.content.canonicalMemberSetSha256,
        });
      } catch {
        return {
          registryRevision: registry.revision,
          selection: null,
          unavailabilityReason: 'gate2_blocked',
        };
      }

      return {
        registryRevision: registry.revision,
        selection: aflTradePromotionBackedArchiveSelectionSchema.parse({
          schemaVersion: AFL_TRADE_PROMOTION_BACKED_ARCHIVE_SELECTION_SCHEMA_VERSION,
          registryRevision: registry.revision,
          scopeKey,
          environment: release.content.environment,
          competition: release.content.competition,
          validFromSeason: release.content.validFromSeason,
          validThroughSeason: release.content.validThroughSeason,
          releaseId: release.releaseId,
          projectionId: projection.projectionId,
          publicArchiveId: projection.content.publicArchiveId,
          factualCandidateId: projection.content.factualCandidateId,
          corpusId: projection.content.corpusId,
          lineageId: currentGate2.lineage.lineageId,
          gate2AdmissionId: currentGate2.admission.admissionId,
          gate2DecisionId: currentGate2.admission.content.gate2DecisionId,
          sourceMemberSetSha256: projection.content.sourceMemberSetSha256,
          canonicalMemberSetSha256: projection.content.canonicalMemberSetSha256,
          publicRecordSetSha256: projection.content.publicRecordSetSha256,
          publicRecordCount: projection.content.publicRecordCount,
          effectiveThrough: projection.content.effectiveThrough,
          publishedAt: pointer.activatedAt,
          capturedAt: evaluatedAt,
        }),
        unavailabilityReason: null,
      };
    },
  };
}
