import { z } from 'zod';

import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import { aflTradeArtifactRefSchema } from './artifactReference';
import { addAflTradeContentAddressIssue, aflTradeContentAddressedIdSchema } from './contentAddress';

const isoDateTimeSchema = z.string().datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const aflTradeCorpusManifestContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-corpus/v1'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    createdAt: isoDateTimeSchema,
    evidenceManifestId: aflTradeContentAddressedIdSchema('evidence'),
    dataSufficiencyProtocolId: aflTradeContentAddressedIdSchema('data-sufficiency-protocol'),
    coverageReportId: aflTradeContentAddressedIdSchema('coverage-report'),
    gate0bDecisionId: aflTradeContentAddressedIdSchema('gate-decision'),
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
    custodyArtifact: aflTradeArtifactRefSchema,
    lineageArtifact: aflTradeArtifactRefSchema,
    reconciliationArtifact: aflTradeArtifactRefSchema,
    qualityReportArtifact: aflTradeArtifactRefSchema,
    quarantineArtifact: aflTradeArtifactRefSchema,
    unsupportedCohorts: z.array(publicIdSchema).max(500),
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
    if (new Set(manifest.unsupportedCohorts).size !== manifest.unsupportedCohorts.length) {
      context.addIssue({
        code: 'custom',
        path: ['unsupportedCohorts'],
        message: 'Unsupported corpus cohorts must be unique.',
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
