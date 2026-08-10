import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_FITZROY_CAPABILITIES,
  AFL_TRADE_FITZROY_PINNED_VERSION,
} from './fitzRoyProviderCapabilities';

export const AFL_TRADE_FITZROY_EGRESS_EXECUTION_SCHEMA_VERSION =
  'afl-trade-fitzroy-egress-execution/v1' as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const artifactIdSchema = z.string().regex(/^artifact:[a-f0-9]{64}$/);

const upstreamRateSchema = z
  .object({
    requests: z.number().int().positive(),
    perSeconds: z.number().int().positive(),
    burst: z.number().int().positive(),
  })
  .strict()
  .superRefine((rate, context) => {
    if (rate.burst < rate.requests) {
      context.addIssue({
        code: 'custom',
        path: ['burst'],
        message: 'The attested burst must not be smaller than the reviewed request allowance.',
      });
    }
  });

const outputBindingSchema = z
  .object({
    contentSha256: sha256Schema,
    byteLength: z.number().int().positive(),
  })
  .strict();

export const aflTradeFitzRoyEgressExecutionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_FITZROY_EGRESS_EXECUTION_SCHEMA_VERSION),
    executionBoundary: z.literal('attested_provider_egress'),
    provider: z.enum([
      'official_afl',
      'afl_tables',
      'footywire',
      'fryzigg',
      'afl_coaches_association',
    ]),
    capabilityId: z.string().min(1),
    directFunction: z.string().min(1),
    fitzRoyVersion: z.literal(AFL_TRADE_FITZROY_PINNED_VERSION),
    invocationSha256: sha256Schema,
    sourceOutput: outputBindingSchema,
    diagnosticsOutput: outputBindingSchema,
    runtime: z
      .object({
        rVersion: z.literal('4.5.1'),
        dependencyLockSha256: sha256Schema,
        imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      })
      .strict(),
    enforcedPolicy: z
      .object({
        upstreamRate: upstreamRateSchema,
        cacheSeconds: z.number().int().positive(),
        egressPolicyEvidenceId: artifactIdSchema,
      })
      .strict(),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    status: z.literal('succeeded'),
  })
  .strict()
  .superRefine((content, context) => {
    const capability = AFL_TRADE_FITZROY_CAPABILITIES.find(
      (candidate) => candidate.capabilityId === content.capabilityId
    );
    if (
      capability === undefined ||
      capability.provider !== content.provider ||
      capability.directFunction !== content.directFunction ||
      capability.fitzRoyVersion !== content.fitzRoyVersion
    ) {
      context.addIssue({
        code: 'custom',
        path: ['capabilityId'],
        message: 'Execution evidence must identify one exact registered fitzRoy capability.',
      });
    }
    const startedAt = Date.parse(content.startedAt);
    const completedAt = Date.parse(content.completedAt);
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(completedAt) ||
      completedAt < startedAt ||
      completedAt - startedAt > 24 * 60 * 60 * 1_000
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Execution chronology must be ordered and bounded to one day.',
      });
    }
  });

export const aflTradeFitzRoyEgressExecutionReceiptSchema = z
  .object({
    executionReceiptId: aflTradeContentAddressedIdSchema('fitzroy-egress-execution'),
    content: aflTradeFitzRoyEgressExecutionContentSchema,
    signature: z
      .object({
        algorithm: z.literal('Ed25519'),
        keyId: z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/),
        valueBase64Url: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
      })
      .strict(),
  })
  .strict()
  .superRefine((receipt, context) => {
    addAflTradeContentAddressIssue(
      'fitzroy-egress-execution',
      receipt.executionReceiptId,
      receipt.content,
      context,
      ['executionReceiptId']
    );
  });

export type AflTradeFitzRoyEgressExecutionReceipt = z.infer<
  typeof aflTradeFitzRoyEgressExecutionReceiptSchema
>;

export interface AflTradeFitzRoyEgressExecutionVerifier {
  verify(receipt: AflTradeFitzRoyEgressExecutionReceipt): Promise<boolean>;
}

export function createAflTradeFitzRoyEgressExecutionReceipt(input: {
  content: z.input<typeof aflTradeFitzRoyEgressExecutionContentSchema>;
  signature: z.input<typeof aflTradeFitzRoyEgressExecutionReceiptSchema>['signature'];
}): AflTradeFitzRoyEgressExecutionReceipt {
  const content = aflTradeFitzRoyEgressExecutionContentSchema.parse(input.content);
  return aflTradeFitzRoyEgressExecutionReceiptSchema.parse({
    executionReceiptId: createAflTradeContentAddress('fitzroy-egress-execution', content),
    content,
    signature: input.signature,
  });
}

export async function authenticateAflTradeFitzRoyEgressExecutionReceipt(
  input: unknown,
  verifier: AflTradeFitzRoyEgressExecutionVerifier
): Promise<AflTradeFitzRoyEgressExecutionReceipt> {
  const receipt = aflTradeFitzRoyEgressExecutionReceiptSchema.parse(input);
  if (!(await verifier.verify(receipt))) {
    throw new Error('The fitzRoy egress execution signature is not trusted.');
  }
  return receipt;
}
