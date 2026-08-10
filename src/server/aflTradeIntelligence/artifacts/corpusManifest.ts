import { z } from 'zod';

import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import { AFL_TRADE_REQUIRED_EVIDENCE_LANES } from '../governance/dataSufficiencyProtocol';
import { aflTradeArtifactRefSchema } from './artifactReference';
import { addAflTradeContentAddressIssue, aflTradeContentAddressedIdSchema } from './contentAddress';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const identityOutcomeCountsSchema = z
  .object({
    candidates: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    ambiguous: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    conflicting: z.number().int().nonnegative(),
    manuallyResolved: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((counts, context) => {
    if (
      counts.candidates !==
      counts.resolved + counts.ambiguous + counts.unresolved + counts.conflicting
    ) {
      context.addIssue({
        code: 'custom',
        path: ['candidates'],
        message: 'Identity candidates must reconcile exactly to their terminal outcomes.',
      });
    }
    if (counts.manuallyResolved > counts.resolved) {
      context.addIssue({
        code: 'custom',
        path: ['manuallyResolved'],
        message: 'Manually resolved identities must be a subset of resolved identities.',
      });
    }
  });

const laneReconciliationSchema = z
  .object({
    lane: z.enum(AFL_TRADE_REQUIRED_EVIDENCE_LANES),
    inputRecords: z.number().int().nonnegative(),
    reconciledInputRecords: z.number().int().nonnegative(),
    quarantinedInputRecords: z.number().int().nonnegative(),
    canonicalRecords: z.number().int().nonnegative(),
    correctionRecords: z.number().int().nonnegative(),
    evidenceToCanonicalMappingArtifact: aflTradeArtifactRefSchema,
  })
  .strict()
  .superRefine((lane, context) => {
    if (lane.inputRecords !== lane.reconciledInputRecords + lane.quarantinedInputRecords) {
      context.addIssue({
        code: 'custom',
        path: ['inputRecords'],
        message: 'Every input record must reconcile or be quarantined.',
      });
    }
  });

export const aflTradeCorpusManifestContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-corpus/v2'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    createdAt: isoDateTimeSchema,
    evidenceManifestId: aflTradeContentAddressedIdSchema('evidence'),
    dataSufficiencyProtocolId: aflTradeContentAddressedIdSchema('data-sufficiency-protocol'),
    coverageReportId: aflTradeContentAddressedIdSchema('coverage-report'),
    gate0bDecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    architectureCurrentStateId: aflTradeContentAddressedIdSchema('architecture-current-state'),
    architectureDecisionPackageId: aflTradeContentAddressedIdSchema(
      'architecture-decision-package'
    ),
    gate1DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    sourceRegisterIds: z.array(publicIdSchema).min(1).max(50),
    knowledgeCutoffAt: isoDateTimeSchema,
    effectiveFrom: isoDateTimeSchema,
    effectiveTo: isoDateTimeSchema,
    recordCounts: z
      .object({
        trades: z.number().int().nonnegative(),
        parties: z.number().int().nonnegative(),
        assets: z.number().int().nonnegative(),
        custodySpells: z.number().int().nonnegative(),
        lineageTransformations: z.number().int().nonnegative(),
        quarantinedRecords: z.number().int().nonnegative(),
        unresolvedValueBearingAssets: z.number().int().nonnegative(),
      })
      .strict(),
    identityResolutionArtifact: aflTradeArtifactRefSchema,
    identityDecisionLedgerArtifact: aflTradeArtifactRefSchema,
    identityOutcomeCounts: identityOutcomeCountsSchema,
    identityPolicy: z
      .object({
        automaticMerge: z.literal('prohibited'),
        ambiguousOutcome: z.literal('quarantine'),
        unresolvedOutcome: z.literal('quarantine'),
        conflictingOutcome: z.literal('quarantine'),
        manualResolutionRequiresEvidence: z.literal(true),
      })
      .strict(),
    custodyArtifact: aflTradeArtifactRefSchema,
    lineageArtifact: aflTradeArtifactRefSchema,
    correctionLedgerArtifact: aflTradeArtifactRefSchema,
    reconciliationArtifact: aflTradeArtifactRefSchema,
    qualityReportArtifact: aflTradeArtifactRefSchema,
    quarantineArtifact: aflTradeArtifactRefSchema,
    laneReconciliations: z
      .array(laneReconciliationSchema)
      .length(AFL_TRADE_REQUIRED_EVIDENCE_LANES.length),
    unsupportedCohortIds: z.array(publicIdSchema).max(500),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (new Set(manifest.sourceRegisterIds).size !== manifest.sourceRegisterIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRegisterIds'],
        message: 'Corpus source-register references must be unique.',
      });
    }
    if (
      new Set(manifest.unsupportedCohortIds).size !== manifest.unsupportedCohortIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['unsupportedCohortIds'],
        message: 'Unsupported corpus cohorts must be unique.',
      });
    }
    const reconciledLanes = manifest.laneReconciliations.map((lane) => lane.lane);
    if (
      new Set(reconciledLanes).size !== reconciledLanes.length ||
      AFL_TRADE_REQUIRED_EVIDENCE_LANES.some((lane) => !reconciledLanes.includes(lane))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['laneReconciliations'],
        message: 'Corpus reconciliation must cover each required evidence lane exactly once.',
      });
    }
    const quarantinedIdentityRecords =
      manifest.identityOutcomeCounts.ambiguous +
      manifest.identityOutcomeCounts.unresolved +
      manifest.identityOutcomeCounts.conflicting;
    if (quarantinedIdentityRecords > manifest.recordCounts.quarantinedRecords) {
      context.addIssue({
        code: 'custom',
        path: ['recordCounts', 'quarantinedRecords'],
        message: 'The quarantine count cannot omit non-resolved identity candidates.',
      });
    }
    if (manifest.recordCounts.unresolvedValueBearingAssets > manifest.recordCounts.assets) {
      context.addIssue({
        code: 'custom',
        path: ['recordCounts', 'unresolvedValueBearingAssets'],
        message: 'Unresolved value-bearing assets cannot exceed all canonical assets.',
      });
    }
    if (Date.parse(manifest.effectiveTo) <= Date.parse(manifest.effectiveFrom)) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveTo'],
        message: 'The corpus effective range must be non-empty.',
      });
    }
    if (Date.parse(manifest.createdAt) < Date.parse(manifest.knowledgeCutoffAt)) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'A corpus cannot be created before its knowledge cutoff.',
      });
    }
  });

export const aflTradeCorpusManifestSchema = z
  .object({
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    content: aflTradeCorpusManifestContentSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    addAflTradeContentAddressIssue('corpus', manifest.corpusId, manifest.content, context, [
      'corpusId',
    ]);
  });

export type AflTradeCorpusManifest = z.infer<typeof aflTradeCorpusManifestSchema>;
