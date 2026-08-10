import { z } from 'zod';

import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
} from './artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from './contentAddress';
import { aflTradeArtifactReadbackReceiptSchema } from './immutableArtifactRepository';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '../governance/gateDecisionTypes';
import { evaluateAflTradeGate0A } from '../source/gate0aEvaluation';
import { aflTradeFitzRoyCaptureReceiptSchema } from '../source/fitzRoyCaptureReceipt';
import { aflTradeGate0AReceiptSchema } from '../source/gate0aReceipt';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceRights';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const sourceFieldSchema = z.string().trim().min(1).max(200);
export const AFL_TRADE_SOURCE_CAPTURE_AUTHORIZATION_MAX_AGE_MS = 15 * 60 * 1000;
const REQUIRED_SOURCE_CAPTURE_OPERATIONS = [
  'bounded_evaluation_capture',
  'raw_evidence_retention',
  'metadata_hash_retention',
] as const;

const exactSortedFieldsSchema = z
  .array(sourceFieldSchema)
  .min(1)
  .max(1000)
  .superRefine((fields, context) => {
    if (new Set(fields).size !== fields.length) {
      context.addIssue({ code: 'custom', message: 'Captured source fields must be unique.' });
    }
    if (fields.some((field, index) => index > 0 && fields[index - 1] > field)) {
      context.addIssue({ code: 'custom', message: 'Captured source fields must be sorted.' });
    }
  });

const workbookCaptureSchema = z
  .object({
    kind: z.literal('workbook'),
    sourceRegisterId: publicIdSchema,
    upstreamProvider: z.string().trim().min(1).max(200),
    upstreamDataset: z.string().trim().min(1).max(300),
    upstreamDatasetVersion: z.string().trim().min(1).max(300),
    originalFilename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((filename) => !filename.includes('/') && !filename.includes('\\'), {
        message: 'Workbook metadata must contain a base filename, not a local path.',
      }),
    workbookFormat: z.enum(['xlsx', 'xls']),
    worksheetNames: z.array(z.string().trim().min(1).max(100)).min(1).max(500),
    importFormatVersion: publicIdSchema,
    accessMechanism: z.enum(['manual_review', 'provider_export']),
  })
  .strict()
  .superRefine((capture, context) => {
    if (new Set(capture.worksheetNames).size !== capture.worksheetNames.length) {
      context.addIssue({
        code: 'custom',
        path: ['worksheetNames'],
        message: 'Worksheet names must be unique.',
      });
    }
    const expected =
      capture.workbookFormat === 'xlsx' ? { extension: '.xlsx' } : { extension: '.xls' };
    if (!capture.originalFilename.toLowerCase().endsWith(expected.extension)) {
      context.addIssue({
        code: 'custom',
        path: ['originalFilename'],
        message: 'Workbook filename extension must match its declared workbook format.',
      });
    }
  });

const fitzRoyCaptureSchema = z
  .object({
    kind: z.literal('fitzroy'),
    sourceRegisterId: publicIdSchema,
    upstreamProvider: z.string().trim().min(1).max(200),
    upstreamDataset: z.string().trim().min(1).max(300),
    upstreamDatasetVersion: z.string().trim().min(1).max(300),
    capabilityId: publicIdSchema,
    packageVersion: publicIdSchema,
    functionName: publicIdSchema,
    argumentsArtifact: aflTradeArtifactRefSchema,
    accessMechanism: z.enum(['provider_api', 'automated_web']),
    rateLimitContext: z.string().trim().min(1).max(1000),
    cacheContext: z.string().trim().min(1).max(1000),
  })
  .strict()
  .superRefine((capture, context) => {
    if (capture.argumentsArtifact.mediaType !== AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE) {
      context.addIssue({
        code: 'custom',
        path: ['argumentsArtifact', 'mediaType'],
        message: 'fitzRoy arguments must be captured as canonical JSON.',
      });
    }
  });

export const aflTradeSourceSnapshotManifestContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-source-snapshot/v3'),
    sourceArtifact: aflTradeArtifactRefSchema,
    readbackReceipt: aflTradeArtifactReadbackReceiptSchema,
    capture: z.discriminatedUnion('kind', [workbookCaptureSchema, fitzRoyCaptureSchema]),
    sourceRightsProposal: aflTradeSourceRightsProposalSchema,
    gate0aProposal: aflTradeGateDecisionProposalSchema,
    gate0aDecision: aflTradeGateDecisionRecordSchema,
    gate0aReceipt: aflTradeGate0AReceiptSchema,
    fitzRoyCaptureReceipt: aflTradeFitzRoyCaptureReceiptSchema.nullable(),
    capturedFields: exactSortedFieldsSchema,
    retrievedAt: isoDateTimeSchema,
    effectiveAt: isoDateTimeSchema,
    retention: z
      .object({
        rawRetentionDays: z.number().int().positive().nullable(),
        deleteOnWithdrawal: z.boolean(),
      })
      .strict(),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const receiptRequest = snapshot.gate0aReceipt.content.request;
    const receiptResult = snapshot.gate0aReceipt.content.result;
    const mechanicalEvaluation = evaluateAflTradeGate0A(
      {
        proposals: [snapshot.gate0aProposal],
        decisions: [snapshot.gate0aDecision],
      },
      snapshot.sourceRightsProposal,
      receiptRequest
    );
    const evaluatedFields = [
      ...new Set(receiptRequest.fieldUses.map(({ sourceField }) => sourceField)),
    ].sort();
    const chronology = [
      Date.parse(snapshot.effectiveAt),
      Date.parse(snapshot.gate0aReceipt.content.recordedAt),
      Date.parse(snapshot.retrievedAt),
      Date.parse(snapshot.readbackReceipt.content.verifiedAt),
      Date.parse(snapshot.createdAt),
    ];
    const retrievedAt = Date.parse(snapshot.retrievedAt);
    const evaluatedAt = Date.parse(receiptRequest.evaluatedAt);
    if (chronology.some((time, index) => index > 0 && chronology[index - 1] > time)) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message:
          'Snapshot evidence must follow effective, authorization, retrieval, and custody time.',
      });
    }
    if (
      !doAflTradeArtifactRefsExactlyMatch(
        snapshot.readbackReceipt.content.artifact,
        snapshot.sourceArtifact
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['readbackReceipt'],
        message: 'The read-back receipt must verify the exact source artifact.',
      });
    }
    const expectedAssurance =
      receiptRequest.environment === 'test_fixture' ? 'fixture_memory' : 'durable_object_storage';
    if (
      snapshot.readbackReceipt.content.artifactClass !== 'raw_source' ||
      snapshot.readbackReceipt.content.repositoryAssurance !== expectedAssurance ||
      snapshot.readbackReceipt.content.custodyEnvironment !== receiptRequest.environment
    ) {
      context.addIssue({
        code: 'custom',
        path: ['readbackReceipt'],
        message:
          'Source snapshots require raw-source custody with assurance and an exact profile environment matching the Gate decision.',
      });
    }
    const custodyProfile = snapshot.readbackReceipt.content.custodyProfile;
    if (receiptRequest.environment !== 'test_fixture') {
      const deletion = custodyProfile?.content.retention.deletion;
      const retentionMatches =
        receiptRequest.rawRetentionDays === null
          ? deletion?.kind === 'no_scheduled_deletion'
          : deletion?.kind === 'maximum_age' &&
            deletion.maximumDays === receiptRequest.rawRetentionDays;
      if (
        custodyProfile === null ||
        !retentionMatches ||
        custodyProfile.content.retention.deleteOnWithdrawal !==
          snapshot.sourceRightsProposal.content.retention.rawEvidence.deleteOnWithdrawal
      ) {
        context.addIssue({
          code: 'custom',
          path: ['readbackReceipt', 'content', 'custodyProfile'],
          message:
            'Durable raw-source custody must bind retention and withdrawal controls exactly matching the authorized capture.',
        });
      }
    }
    if (
      REQUIRED_SOURCE_CAPTURE_OPERATIONS.some(
        (operation) => !receiptRequest.operations.includes(operation)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['gate0aReceipt', 'content', 'request', 'operations'],
        message:
          'Snapshot custody requires capture, raw-evidence retention, and metadata-hash retention authorization.',
      });
    }
    if (
      retrievedAt < evaluatedAt ||
      retrievedAt - evaluatedAt > AFL_TRADE_SOURCE_CAPTURE_AUTHORIZATION_MAX_AGE_MS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['retrievedAt'],
        message: 'Source capture must occur within 15 minutes of its Gate 0A evaluation.',
      });
    }
    if (
      (snapshot.sourceRightsProposal.content.termsEffectiveAt !== null &&
        retrievedAt < Date.parse(snapshot.sourceRightsProposal.content.termsEffectiveAt)) ||
      (snapshot.sourceRightsProposal.content.termsExpireAt !== null &&
        retrievedAt >= Date.parse(snapshot.sourceRightsProposal.content.termsExpireAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['retrievedAt'],
        message: 'Source capture must occur while the approved source rights are current.',
      });
    }
    if (
      snapshot.gate0aDecision.content.effectiveAt === null ||
      retrievedAt < Date.parse(snapshot.gate0aDecision.content.effectiveAt) ||
      (snapshot.gate0aDecision.content.revalidateAt !== null &&
        retrievedAt >= Date.parse(snapshot.gate0aDecision.content.revalidateAt))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['retrievedAt'],
        message: 'Source capture must occur while the Gate 0A decision is effective.',
      });
    }
    if (
      snapshot.sourceRightsProposal.rightsArtifactId !== receiptRequest.rightsArtifactId ||
      receiptResult.rightsArtifactId !== snapshot.sourceRightsProposal.rightsArtifactId ||
      receiptResult.status !== 'mechanically_eligible' ||
      receiptResult.decisionId !== snapshot.gate0aDecision.decisionId ||
      snapshot.gate0aDecision.content.proposalId !== snapshot.gate0aProposal.proposalId ||
      snapshot.gate0aDecision.content.gate !== 'gate_0a_permission_to_evaluate' ||
      snapshot.gate0aDecision.content.environment !== receiptRequest.environment ||
      !snapshot.gate0aDecision.content.affectedArtifacts.some(
        ({ kind, artifactId }) =>
          kind === 'source_rights' && artifactId === snapshot.sourceRightsProposal.rightsArtifactId
      ) ||
      mechanicalEvaluation.status !== 'mechanically_eligible' ||
      mechanicalEvaluation.decisionId !== snapshot.gate0aDecision.decisionId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['gate0aReceipt'],
        message: 'The snapshot must bind one exact eligible Gate 0A rights chain.',
      });
    }
    if (snapshot.capture.accessMechanism !== receiptRequest.accessMechanism) {
      context.addIssue({
        code: 'custom',
        path: ['capture', 'accessMechanism'],
        message: 'Capture metadata must match the evaluated access mechanism.',
      });
    }
    if (
      snapshot.capture.sourceRegisterId !== snapshot.sourceRightsProposal.content.registerId ||
      snapshot.capture.upstreamProvider !== snapshot.sourceRightsProposal.content.provider ||
      snapshot.capture.upstreamDataset !== snapshot.sourceRightsProposal.content.dataset ||
      snapshot.capture.upstreamDatasetVersion !==
        snapshot.sourceRightsProposal.content.datasetVersion
    ) {
      context.addIssue({
        code: 'custom',
        path: ['capture'],
        message: 'Capture source identity must exactly match the approved source-rights register.',
      });
    }
    if (snapshot.capture.kind === 'workbook') {
      const expectedMediaType =
        snapshot.capture.workbookFormat === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/vnd.ms-excel';
      if (snapshot.sourceArtifact.mediaType !== expectedMediaType) {
        context.addIssue({
          code: 'custom',
          path: ['sourceArtifact', 'mediaType'],
          message: 'Workbook artifact media type must match its declared workbook format.',
        });
      }
      if (
        snapshot.sourceRightsProposal.content.acquisition.kind !== 'provided_artifact' ||
        snapshot.sourceRightsProposal.content.acquisition.mediaType !== expectedMediaType
      ) {
        context.addIssue({
          code: 'custom',
          path: ['capture'],
          message: 'Workbook capture must match an approved provided-artifact acquisition profile.',
        });
      }
      if (snapshot.fitzRoyCaptureReceipt !== null) {
        context.addIssue({
          code: 'custom',
          path: ['fitzRoyCaptureReceipt'],
          message: 'Workbook snapshots cannot bind a fitzRoy capture receipt.',
        });
      }
    } else {
      const capture = snapshot.capture;
      const captureReceipt = snapshot.fitzRoyCaptureReceipt;
      const acquisition = snapshot.sourceRightsProposal.content.acquisition;
      const binding =
        acquisition.kind === 'fitzroy'
          ? acquisition.capabilities.find(
              (capability) => capability.capabilityId === capture.capabilityId
            )
          : undefined;
      if (
        acquisition.kind !== 'fitzroy' ||
        binding === undefined ||
        receiptRequest.capabilityId !== capture.capabilityId ||
        capture.upstreamProvider !== binding.provider ||
        capture.packageVersion !== acquisition.fitzRoyVersion ||
        capture.functionName !== binding.directFunction
      ) {
        context.addIssue({
          code: 'custom',
          path: ['capture'],
          message:
            'fitzRoy capture must match the evaluated capability, pinned package, and approved direct function.',
        });
      }
      if (
        captureReceipt === null ||
        captureReceipt.content.authorizationReceipt.receiptId !==
          snapshot.gate0aReceipt.receiptId ||
        !doAflTradeArtifactRefsExactlyMatch(
          captureReceipt.content.sourceCustody.artifact,
          snapshot.sourceArtifact
        ) ||
        captureReceipt.content.sourceCustody.readback.receiptId !==
          snapshot.readbackReceipt.receiptId ||
        !doAflTradeArtifactRefsExactlyMatch(
          captureReceipt.content.invocationCustody.artifact,
          capture.argumentsArtifact
        ) ||
        captureReceipt.content.invocation.capabilityId !== capture.capabilityId ||
        captureReceipt.content.invocation.provider !== binding?.provider ||
        captureReceipt.content.invocation.fitzRoyVersion !== capture.packageVersion ||
        captureReceipt.content.invocation.directFunction !== capture.functionName ||
        captureReceipt.content.capturedAt !== snapshot.retrievedAt ||
        Date.parse(captureReceipt.content.capturedAt) > Date.parse(snapshot.createdAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['fitzRoyCaptureReceipt'],
          message:
            'A fitzRoy snapshot must bind the exact authorized invocation, returned bytes, read-back, and capture time.',
        });
      }
      if (receiptRequest.environment !== 'test_fixture') {
        const execution = captureReceipt?.content.egressExecutionReceipt?.content;
        const reviewedRate = snapshot.sourceRightsProposal.content.automatedAccess.rateLimit;
        const reviewedEgressEvidenceIds = [
          ...new Set(
            snapshot.sourceRightsProposal.content.conditions
              .filter(({ conditionId }) => conditionId === 'provider-egress-control')
              .flatMap(({ verificationEvidenceIds }) => verificationEvidenceIds)
          ),
        ];
        if (
          execution === undefined ||
          reviewedRate === null ||
          reviewedEgressEvidenceIds.length !== 1 ||
          execution.provider !== snapshot.sourceRightsProposal.content.provider ||
          execution.capabilityId !== capture.capabilityId ||
          execution.enforcedPolicy.upstreamRate.requests !== reviewedRate.requests ||
          execution.enforcedPolicy.upstreamRate.perSeconds !== reviewedRate.perSeconds ||
          execution.enforcedPolicy.upstreamRate.burst !== reviewedRate.burst ||
          execution.enforcedPolicy.cacheSeconds !== receiptRequest.cacheSeconds ||
          execution.enforcedPolicy.egressPolicyEvidenceId !== reviewedEgressEvidenceIds[0]
        ) {
          context.addIssue({
            code: 'custom',
            path: ['fitzRoyCaptureReceipt', 'egressExecutionReceipt'],
            message:
              'Provider-egress execution must match the exact source-rights rate, cache, capability, provider, and policy evidence.',
          });
        }
      }
      if (
        Date.parse(capture.argumentsArtifact.createdAt) > Date.parse(receiptRequest.evaluatedAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['capture', 'argumentsArtifact', 'createdAt'],
          message: 'fitzRoy arguments must be content-addressed before capture authorization.',
        });
      }
    }
    if (
      snapshot.capturedFields.length !== evaluatedFields.length ||
      snapshot.capturedFields.some((field, index) => field !== evaluatedFields[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['capturedFields'],
        message: 'Captured fields must exactly match the Gate 0A evaluation receipt.',
      });
    }
    if (
      snapshot.retention.rawRetentionDays !== receiptRequest.rawRetentionDays ||
      snapshot.retention.deleteOnWithdrawal !==
        snapshot.sourceRightsProposal.content.retention.rawEvidence.deleteOnWithdrawal
    ) {
      context.addIssue({
        code: 'custom',
        path: ['retention'],
        message: 'Snapshot retention must match the evaluated source-rights duties.',
      });
    }
  });

export const aflTradeSourceSnapshotManifestSchema = z
  .object({
    snapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
    content: aflTradeSourceSnapshotManifestContentSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    addAflTradeContentAddressIssue(
      'source-snapshot',
      snapshot.snapshotId,
      snapshot.content,
      context,
      ['snapshotId']
    );
  });

export type AflTradeSourceSnapshotManifest = z.infer<typeof aflTradeSourceSnapshotManifestSchema>;

export function createAflTradeSourceSnapshotManifest(
  content: z.input<typeof aflTradeSourceSnapshotManifestContentSchema>
): AflTradeSourceSnapshotManifest {
  const parsedContent = aflTradeSourceSnapshotManifestContentSchema.parse(content);
  return aflTradeSourceSnapshotManifestSchema.parse({
    snapshotId: createAflTradeContentAddress('source-snapshot', parsedContent),
    content: parsedContent,
  });
}
