import { z } from 'zod';

import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import { aflTradeArtifactRefSchema } from './artifactReference';
import { addAflTradeContentAddressIssue, aflTradeContentAddressedIdSchema } from './contentAddress';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const aflTradeSourceAuthorizationRefSchema = z
  .object({
    authorizationId: publicIdSchema,
    sourceRegisterId: publicIdSchema,
    rightsArtifactId: aflTradeContentAddressedIdSchema('source-rights'),
    gate0aDecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    gate0aReceiptId: aflTradeContentAddressedIdSchema('gate0a-evaluation'),
  })
  .strict();

export const aflTradeEvidenceItemContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-evidence-item/v1'),
    authorizationId: publicIdSchema,
    sourceRegisterId: publicIdSchema,
    artifact: aflTradeArtifactRefSchema,
    capturedFields: z.array(z.string().trim().min(1).max(200)).min(1).max(1000),
    adapterVersion: publicIdSchema,
    sourcePublishedAt: isoDateTimeSchema.nullable(),
    retrievedAt: isoDateTimeSchema,
    effectiveFrom: isoDateTimeSchema,
    effectiveTo: isoDateTimeSchema.nullable(),
    knownFrom: isoDateTimeSchema,
    knownTo: isoDateTimeSchema.nullable(),
    recordCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((item, context) => {
    if (new Set(item.capturedFields).size !== item.capturedFields.length) {
      context.addIssue({
        code: 'custom',
        path: ['capturedFields'],
        message: 'Captured source fields must be unique.',
      });
    }
    if (item.effectiveTo && Date.parse(item.effectiveTo) <= Date.parse(item.effectiveFrom)) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveTo'],
        message: 'Effective time must be a non-empty half-open interval.',
      });
    }
    if (item.knownTo && Date.parse(item.knownTo) <= Date.parse(item.knownFrom)) {
      context.addIssue({
        code: 'custom',
        path: ['knownTo'],
        message: 'Knowledge time must be a non-empty half-open interval.',
      });
    }
    if (Date.parse(item.knownFrom) < Date.parse(item.retrievedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['knownFrom'],
        message: 'Evidence cannot become known before it is retrieved.',
      });
    }
  });

export const aflTradeEvidenceItemSchema = z
  .object({
    evidenceItemId: aflTradeContentAddressedIdSchema('evidence-item'),
    content: aflTradeEvidenceItemContentSchema,
  })
  .strict()
  .superRefine((item, context) => {
    addAflTradeContentAddressIssue('evidence-item', item.evidenceItemId, item.content, context, [
      'evidenceItemId',
    ]);
  });

export const aflTradeEvidenceManifestContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-evidence/v1'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    createdAt: isoDateTimeSchema,
    sourceAuthorizations: z.array(aflTradeSourceAuthorizationRefSchema).min(1).max(500),
    items: z.array(aflTradeEvidenceItemSchema).min(1).max(10_000),
    captureConfigurationArtifact: aflTradeArtifactRefSchema,
    adapterCodeArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(50),
    sourceSchemaArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(50),
  })
  .strict()
  .superRefine((manifest, context) => {
    const authorizationIds = manifest.sourceAuthorizations.map(
      (authorization) => authorization.authorizationId
    );
    if (new Set(authorizationIds).size !== authorizationIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceAuthorizations'],
        message: 'Source authorization identifiers must be unique.',
      });
    }
    const receiptIds = manifest.sourceAuthorizations.map(
      (authorization) => authorization.gate0aReceiptId
    );
    if (new Set(receiptIds).size !== receiptIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceAuthorizations'],
        message: 'Each Gate 0A evaluation receipt may authorize only one manifest entry.',
      });
    }
    const authorizationById = new Map(
      manifest.sourceAuthorizations.map((authorization) => [
        authorization.authorizationId,
        authorization,
      ])
    );
    const itemIds = manifest.items.map((item) => item.evidenceItemId);
    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Evidence items must be unique.',
      });
    }
    for (const [index, item] of manifest.items.entries()) {
      const authorization = authorizationById.get(item.content.authorizationId);
      if (!authorization || authorization.sourceRegisterId !== item.content.sourceRegisterId) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'content', 'authorizationId'],
          message: 'Every evidence item must reference its exact source authorization.',
        });
      }
      if (Date.parse(item.content.retrievedAt) > Date.parse(manifest.createdAt)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'content', 'retrievedAt'],
          message: 'Evidence cannot be retrieved after its manifest is created.',
        });
      }
    }
  });

export const aflTradeEvidenceManifestSchema = z
  .object({
    manifestId: aflTradeContentAddressedIdSchema('evidence'),
    content: aflTradeEvidenceManifestContentSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    addAflTradeContentAddressIssue('evidence', manifest.manifestId, manifest.content, context, [
      'manifestId',
    ]);
  });

export type AflTradeSourceAuthorizationRef = z.infer<typeof aflTradeSourceAuthorizationRefSchema>;
export type AflTradeEvidenceItem = z.infer<typeof aflTradeEvidenceItemSchema>;
export type AflTradeEvidenceManifest = z.infer<typeof aflTradeEvidenceManifestSchema>;
