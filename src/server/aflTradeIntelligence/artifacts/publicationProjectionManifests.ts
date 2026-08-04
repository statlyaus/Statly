import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

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

export const aflTradePublicationManifestContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-publication/v2'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    createdAt: isoDateTimeSchema,
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    gate3DecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
    sourceRegisterIds: z.array(publicIdSchema).min(1).max(50),
    supportedViews: z.array(z.enum(AFL_TRADE_VALUATION_VIEWS)).min(1),
    supportedCohorts: z.array(publicIdSchema).min(1).max(500),
    excludedCohorts: z.array(publicIdSchema).max(500),
    valueUnitId: publicIdSchema,
    entryCount: z.number().int().nonnegative(),
    publicationBundleArtifact: aflTradeArtifactRefSchema,
    methodologyArtifact: aflTradeArtifactRefSchema,
    validationReportArtifact: aflTradeArtifactRefSchema,
    modelCardArtifact: aflTradeArtifactRefSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    for (const [field, values] of [
      ['sourceRegisterIds', manifest.sourceRegisterIds],
      ['supportedViews', manifest.supportedViews],
      ['supportedCohorts', manifest.supportedCohorts],
      ['excludedCohorts', manifest.excludedCohorts],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} members must be unique.`,
        });
      }
    }
    const excluded = new Set(manifest.excludedCohorts);
    if (manifest.supportedCohorts.some((cohort) => excluded.has(cohort))) {
      context.addIssue({
        code: 'custom',
        path: ['excludedCohorts'],
        message: 'A publication cohort cannot be both supported and excluded.',
      });
    }
  });

export const aflTradePublicationManifestSchema = z
  .object({
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    content: aflTradePublicationManifestContentSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    addAflTradeContentAddressIssue(
      'publication',
      manifest.publicationId,
      manifest.content,
      context,
      ['publicationId']
    );
  });

export const aflTradeProjectionManifestContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-projection/v1'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    createdAt: isoDateTimeSchema,
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    buildJobId: publicIdSchema,
    responseContractVersion: z.literal('afl-trade-value/v2'),
    documentCount: z.number().int().nonnegative(),
    projectionArtifact: aflTradeArtifactRefSchema,
    schemaArtifact: aflTradeArtifactRefSchema,
    parityReportArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

export const aflTradeProjectionManifestSchema = z
  .object({
    projectionId: aflTradeContentAddressedIdSchema('projection'),
    content: aflTradeProjectionManifestContentSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    addAflTradeContentAddressIssue('projection', manifest.projectionId, manifest.content, context, [
      'projectionId',
    ]);
  });

export type AflTradePublicationManifest = z.infer<typeof aflTradePublicationManifestSchema>;
export type AflTradeProjectionManifest = z.infer<typeof aflTradeProjectionManifestSchema>;
