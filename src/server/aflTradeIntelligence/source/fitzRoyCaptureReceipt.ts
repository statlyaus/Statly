import { z } from 'zod';

import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchCanonicalJson,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeArtifactReadbackReceiptSchema } from '../artifacts/immutableArtifactRepository';
import {
  AFL_TRADE_FITZROY_DIAGNOSTICS_SCHEMA_VERSION,
  aflTradeFitzRoyInvocationSchema,
  aflTradeFitzRoyCaptureDiagnosticsSchema,
  createAflTradeFitzRoySchemaFingerprint,
  getAflTradeFitzRoyObservedScopeError,
} from './fitzRoyCaptureContracts';
import { aflTradeFitzRoyEgressExecutionReceiptSchema } from './fitzRoyEgressExecutionReceipt';
import { AFL_TRADE_FITZROY_CAPABILITIES } from './fitzRoyProviderCapabilities';
import { aflTradeGate0AReceiptSchema } from './gate0aReceipt';

export const AFL_TRADE_FITZROY_RDS_MEDIA_TYPE = 'application/x-r-rds' as const;
export const AFL_TRADE_FITZROY_CAPTURE_RECEIPT_SCHEMA_VERSION =
  'afl-trade-fitzroy-capture/v2' as const;

const custodyBindingSchema = z
  .object({
    artifact: aflTradeArtifactRefSchema,
    readback: aflTradeArtifactReadbackReceiptSchema,
  })
  .strict()
  .superRefine((binding, context) => {
    if (!doAflTradeArtifactRefsExactlyMatch(binding.artifact, binding.readback.content.artifact)) {
      context.addIssue({
        code: 'custom',
        path: ['readback'],
        message: 'Capture custody must bind one exact artifact and read-back receipt.',
      });
    }
  });

export const aflTradeFitzRoyCaptureReceiptContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_FITZROY_CAPTURE_RECEIPT_SCHEMA_VERSION),
    invocation: aflTradeFitzRoyInvocationSchema,
    authorizationReceipt: aflTradeGate0AReceiptSchema,
    invocationCustody: custodyBindingSchema,
    sourceCustody: custodyBindingSchema,
    diagnosticsCustody: custodyBindingSchema,
    egressExecutionCustody: custodyBindingSchema.nullable(),
    egressExecutionReceipt: aflTradeFitzRoyEgressExecutionReceiptSchema.nullable(),
    diagnostics: aflTradeFitzRoyCaptureDiagnosticsSchema,
    schemaFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    capturedAt: z.iso.datetime({ offset: true }),
    status: z.literal('captured'),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.authorizationReceipt.content.result.status !== 'mechanically_eligible' ||
      receipt.authorizationReceipt.content.request.capabilityId !==
        receipt.invocation.capabilityId ||
      receipt.authorizationReceipt.content.request.season !== receipt.invocation.authorizationSeason
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authorizationReceipt'],
        message: 'Capture requires an eligible Gate 0A receipt for this capability and season.',
      });
    }
    const capability = AFL_TRADE_FITZROY_CAPABILITIES.find(
      (candidate) => candidate.capabilityId === receipt.invocation.capabilityId
    );
    const invocationCompetition = receipt.invocation.arguments.comp;
    const authorizedCompetition = receipt.authorizationReceipt.content.request.competition;
    if (
      (typeof invocationCompetition === 'string' &&
        invocationCompetition !== authorizedCompetition) ||
      (invocationCompetition === undefined &&
        (capability === undefined ||
          capability.competitions.length !== 1 ||
          capability.competitions[0] !== authorizedCompetition))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authorizationReceipt'],
        message: 'Capture invocation competition must equal the Gate 0A authorization.',
      });
    }
    if (
      receipt.invocationCustody.artifact.mediaType !==
        AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE ||
      !doesAflTradeArtifactRefMatchCanonicalJson(
        receipt.invocationCustody.artifact,
        receipt.invocation
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['invocationCustody', 'artifact'],
        message: 'Invocation custody must preserve the exact canonical invocation JSON.',
      });
    }
    if (receipt.sourceCustody.artifact.mediaType !== AFL_TRADE_FITZROY_RDS_MEDIA_TYPE) {
      context.addIssue({
        code: 'custom',
        path: ['sourceCustody', 'artifact', 'mediaType'],
        message: 'fitzRoy source custody must preserve the exact returned RDS bytes.',
      });
    }
    if (
      receipt.diagnosticsCustody.artifact.mediaType !==
        AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE ||
      !doesAflTradeArtifactRefMatchCanonicalJson(
        receipt.diagnosticsCustody.artifact,
        receipt.diagnostics
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['diagnosticsCustody', 'artifact'],
        message: 'Diagnostics custody must preserve the exact canonical diagnostics JSON.',
      });
    }
    const fixtureCapture =
      receipt.authorizationReceipt.content.request.environment === 'test_fixture';
    if (fixtureCapture) {
      if (receipt.egressExecutionReceipt !== null || receipt.egressExecutionCustody !== null) {
        context.addIssue({
          code: 'custom',
          path: ['egressExecutionReceipt'],
          message: 'A no-network fixture capture cannot carry production egress evidence.',
        });
      }
    } else if (receipt.egressExecutionReceipt === null || receipt.egressExecutionCustody === null) {
      context.addIssue({
        code: 'custom',
        path: ['egressExecutionReceipt'],
        message: 'A non-fixture capture requires authenticated provider-egress evidence.',
      });
    } else {
      const execution = receipt.egressExecutionReceipt.content;
      const executionArtifact = receipt.egressExecutionCustody.artifact;
      if (
        executionArtifact.mediaType !== AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE ||
        !doesAflTradeArtifactRefMatchCanonicalJson(
          executionArtifact,
          receipt.egressExecutionReceipt
        ) ||
        receipt.egressExecutionCustody.readback.content.artifactClass !== 'capture_metadata' ||
        execution.provider !== receipt.invocation.provider ||
        execution.capabilityId !== receipt.invocation.capabilityId ||
        execution.directFunction !== receipt.invocation.directFunction ||
        execution.fitzRoyVersion !== receipt.invocation.fitzRoyVersion ||
        execution.invocationSha256 !== receipt.invocationCustody.artifact.contentSha256 ||
        execution.sourceOutput.contentSha256 !== receipt.sourceCustody.artifact.contentSha256 ||
        execution.sourceOutput.byteLength !== receipt.sourceCustody.artifact.byteLength ||
        execution.diagnosticsOutput.contentSha256 !==
          receipt.diagnosticsCustody.artifact.contentSha256 ||
        execution.diagnosticsOutput.byteLength !== receipt.diagnosticsCustody.artifact.byteLength ||
        execution.runtime.rVersion !== receipt.diagnostics.runtime.rVersion ||
        execution.runtime.dependencyLockSha256 !==
          receipt.diagnostics.runtime.dependencyLockSha256 ||
        execution.runtime.imageDigest !== receipt.diagnostics.runtime.imageDigest ||
        execution.enforcedPolicy.cacheSeconds !==
          receipt.authorizationReceipt.content.request.cacheSeconds
      ) {
        context.addIssue({
          code: 'custom',
          path: ['egressExecutionReceipt'],
          message:
            'Provider-egress evidence must bind the exact invocation, outputs, runtime, authorization, and metadata custody.',
        });
      }
    }
    const invocationReadback = receipt.invocationCustody.readback.content;
    const sourceReadback = receipt.sourceCustody.readback.content;
    const diagnosticsReadback = receipt.diagnosticsCustody.readback.content;
    if (
      invocationReadback.artifactClass !== 'capture_metadata' ||
      diagnosticsReadback.artifactClass !== 'capture_metadata' ||
      sourceReadback.artifactClass !== 'raw_source' ||
      invocationReadback.repositoryAssurance !== diagnosticsReadback.repositoryAssurance ||
      invocationReadback.repositoryAssurance !== sourceReadback.repositoryAssurance
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceCustody'],
        message:
          'Capture receipt must bind separate raw-source and capture-metadata custody under one assurance class.',
      });
    }
    if (
      receipt.diagnostics.schemaVersion !== AFL_TRADE_FITZROY_DIAGNOSTICS_SCHEMA_VERSION ||
      receipt.diagnostics.capabilityId !== receipt.invocation.capabilityId ||
      receipt.diagnostics.fitzRoyVersion !== receipt.invocation.fitzRoyVersion ||
      receipt.diagnostics.directFunction !== receipt.invocation.directFunction ||
      receipt.diagnostics.invocationSha256 !== receipt.invocationCustody.artifact.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['diagnostics'],
        message: 'Runtime diagnostics must identify and consume the exact invocation.',
      });
    }
    if (receipt.schemaFingerprint !== createAflTradeFitzRoySchemaFingerprint(receipt.diagnostics)) {
      context.addIssue({
        code: 'custom',
        path: ['schemaFingerprint'],
        message: 'Schema fingerprint must match the captured R field contract.',
      });
    }
    const observedScopeError = getAflTradeFitzRoyObservedScopeError(
      receipt.invocation,
      receipt.diagnostics
    );
    if (observedScopeError !== null) {
      context.addIssue({
        code: 'custom',
        path: ['diagnostics'],
        message: observedScopeError,
      });
    }
    if (receipt.diagnostics.rowCount === 0 || receipt.diagnostics.duplicateRowCount > 0) {
      context.addIssue({
        code: 'custom',
        path: ['diagnostics'],
        message: 'A successful capture requires rows and cannot contain exact duplicate rows.',
      });
    }
    if (receipt.diagnostics.conditions.some((condition) => condition.kind === 'warning')) {
      context.addIssue({
        code: 'custom',
        path: ['diagnostics', 'conditions'],
        message: 'Warnings require review and cannot form a successful source capture.',
      });
    }
    const returnedFields = [...receipt.diagnostics.fields.map(({ name }) => name)].sort();
    const authorizedFields = [
      ...new Set(
        receipt.authorizationReceipt.content.request.fieldUses.map(({ sourceField }) => sourceField)
      ),
    ].sort();
    if (
      returnedFields.length !== authorizedFields.length ||
      returnedFields.some((field, index) => field !== authorizedFields[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['diagnostics', 'fields'],
        message: 'The exact returned source-field set must match the Gate 0A authorization.',
      });
    }
    const chronology = [
      receipt.authorizationReceipt.content.request.evaluatedAt,
      receipt.authorizationReceipt.content.recordedAt,
      receipt.invocationCustody.readback.content.verifiedAt,
      receipt.capturedAt,
    ].map(Date.parse);
    const capturedAt = Date.parse(receipt.capturedAt);
    const authorizationRecordedAt = Date.parse(receipt.authorizationReceipt.content.recordedAt);
    const sourceVerifiedAt = Date.parse(receipt.sourceCustody.readback.content.verifiedAt);
    const diagnosticsVerifiedAt = Date.parse(
      receipt.diagnosticsCustody.readback.content.verifiedAt
    );
    const egressCompletedAt =
      receipt.egressExecutionReceipt === null
        ? capturedAt
        : Date.parse(receipt.egressExecutionReceipt.content.completedAt);
    if (
      chronology.some((time, index) => index > 0 && chronology[index - 1] > time) ||
      sourceVerifiedAt < authorizationRecordedAt ||
      sourceVerifiedAt > capturedAt ||
      diagnosticsVerifiedAt < authorizationRecordedAt ||
      diagnosticsVerifiedAt > capturedAt ||
      egressCompletedAt < authorizationRecordedAt ||
      egressCompletedAt > capturedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['capturedAt'],
        message:
          'Capture observation must follow authorization and per-capture custody verification.',
      });
    }
  });

export const aflTradeFitzRoyCaptureReceiptSchema = z
  .object({
    captureReceiptId: aflTradeContentAddressedIdSchema('fitzroy-capture'),
    content: aflTradeFitzRoyCaptureReceiptContentSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    addAflTradeContentAddressIssue(
      'fitzroy-capture',
      receipt.captureReceiptId,
      receipt.content,
      context,
      ['captureReceiptId']
    );
  });

export type AflTradeFitzRoyCaptureReceipt = z.infer<typeof aflTradeFitzRoyCaptureReceiptSchema>;

export function createAflTradeFitzRoyCaptureReceipt(
  content: z.input<typeof aflTradeFitzRoyCaptureReceiptContentSchema>
): AflTradeFitzRoyCaptureReceipt {
  const parsedContent = aflTradeFitzRoyCaptureReceiptContentSchema.parse(content);
  return aflTradeFitzRoyCaptureReceiptSchema.parse({
    captureReceiptId: createAflTradeContentAddress('fitzroy-capture', parsedContent),
    content: parsedContent,
  });
}
