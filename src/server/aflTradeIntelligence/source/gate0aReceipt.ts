import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflTradeGateDecisionLedger } from '../governance/gateDecisionLedger';
import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import {
  evaluateAflTradeGate0A,
  type AflTradeGate0ABlockerCode,
  type AflTradeGate0ARequest,
} from './gate0aEvaluation';
import {
  AFL_TRADE_SOURCE_OPERATIONS,
  AFL_TRADE_SOURCE_USES,
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceRightsProposal,
} from './sourceRights';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const boundedTextSchema = z.string().trim().min(1).max(1000);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const AFL_TRADE_GATE0A_BLOCKER_CODES = [
  'invalid_rights_artifact',
  'invalid_evaluation_time',
  'gate_decision_blocked',
  'decision_rights_mismatch',
  'decision_scope_mismatch',
  'terms_not_current',
  'competition_not_permitted',
  'season_not_permitted',
  'access_not_permitted',
  'capability_not_permitted',
  'geography_not_permitted',
  'commercial_context_not_permitted',
  'audience_not_permitted',
  'operation_not_permitted',
  'field_not_registered',
  'field_use_not_permitted',
  'retention_not_permitted',
  'cache_not_permitted',
  'source_condition_unsatisfied',
  'duplicate_request',
] as const satisfies readonly AflTradeGate0ABlockerCode[];

export const aflTradeGate0AReceiptRequestSchema = z
  .object({
    decisionKey: publicIdSchema,
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    rightsArtifactId: aflTradeContentAddressedIdSchema('source-rights'),
    evaluatedAt: isoDateTimeSchema,
    competition: publicIdSchema,
    season: z.number().int().min(1897).max(2200),
    accessMechanism: z.enum(['manual_review', 'provider_export', 'provider_api', 'automated_web']),
    capabilityId: publicIdSchema.nullable(),
    geography: boundedTextSchema,
    commercialContext: boundedTextSchema,
    audience: boundedTextSchema,
    operations: z.array(z.enum(AFL_TRADE_SOURCE_OPERATIONS)).min(1).max(50),
    fieldUses: z
      .array(
        z
          .object({
            sourceField: z.string().trim().min(1).max(200),
            use: z.enum(AFL_TRADE_SOURCE_USES),
          })
          .strict()
      )
      .max(1000),
    rawRetentionDays: z.number().int().positive().nullable(),
    metadataRetentionDays: z.number().int().positive().nullable(),
    cacheSeconds: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const aflTradeGate0AReceiptContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-gate0a-evaluation/v2'),
    request: aflTradeGate0AReceiptRequestSchema,
    result: z
      .object({
        status: z.enum(['mechanically_eligible', 'blocked']),
        decisionId: aflTradeContentAddressedIdSchema('gate-decision').nullable(),
        rightsArtifactId: aflTradeContentAddressedIdSchema('source-rights'),
        blockers: z.array(
          z
            .object({
              code: z.enum(AFL_TRADE_GATE0A_BLOCKER_CODES),
              message: boundedTextSchema,
              subject: boundedTextSchema,
            })
            .strict()
        ),
      })
      .strict(),
    recordedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.result.rightsArtifactId !== receipt.request.rightsArtifactId) {
      context.addIssue({
        code: 'custom',
        path: ['result', 'rightsArtifactId'],
        message: 'The receipt result must identify the evaluated source-rights artifact.',
      });
    }
    if (receipt.result.status === 'mechanically_eligible') {
      if (receipt.result.decisionId === null || receipt.result.blockers.length !== 0) {
        context.addIssue({
          code: 'custom',
          path: ['result'],
          message: 'Mechanical eligibility requires one decision and no blockers.',
        });
      }
    } else if (receipt.result.blockers.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['result', 'blockers'],
        message: 'A blocked evaluation receipt requires at least one blocker.',
      });
    }
    if (Date.parse(receipt.recordedAt) < Date.parse(receipt.request.evaluatedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['recordedAt'],
        message: 'A Gate 0A receipt cannot be recorded before its evaluation time.',
      });
    }
  });

export const aflTradeGate0AReceiptSchema = z
  .object({
    receiptId: aflTradeContentAddressedIdSchema('gate0a-evaluation'),
    content: aflTradeGate0AReceiptContentSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    addAflTradeContentAddressIssue(
      'gate0a-evaluation',
      receipt.receiptId,
      receipt.content,
      context,
      ['receiptId']
    );
  });

export function createAflTradeGate0AReceipt(
  ledger: AflTradeGateDecisionLedger,
  unparsedRights: AflTradeSourceRightsProposal,
  unparsedRequest: AflTradeGate0ARequest,
  recordedAt: string
): AflTradeGate0AReceipt {
  const rights = aflTradeSourceRightsProposalSchema.parse(unparsedRights);
  const request = aflTradeGate0AReceiptRequestSchema.parse(unparsedRequest);
  const result = evaluateAflTradeGate0A(ledger, rights, request);
  const content = aflTradeGate0AReceiptContentSchema.parse({
    schemaVersion: 'afl-trade-gate0a-evaluation/v2',
    request,
    result,
    recordedAt,
  });
  return aflTradeGate0AReceiptSchema.parse({
    receiptId: createAflTradeContentAddress('gate0a-evaluation', content),
    content,
  });
}

export type AflTradeGate0AReceipt = z.infer<typeof aflTradeGate0AReceiptSchema>;
