import { types as nodeUtilTypes } from 'node:util';

import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import {
  AFL_TRADE_PROJECTION_PRESENTATION_POLICY_SCHEMA_VERSION,
  aflTradeProjectionPresentationUniversalLayerSchema,
} from '../publication/projectionPresentationPolicy';
import { AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION } from '../publication/projectionPublicEvidence';
import {
  AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  aflTradeArtifactRefSchema,
} from './artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
} from './contentAddress';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const canonicalJsonArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  (reference) => reference.mediaType === AFL_TRADE_CANONICAL_JSON_ARTIFACT_MEDIA_TYPE,
  'Semantic publication and projection bindings require canonical JSON artifacts.'
);

const PUBLIC_ASSET_BOUNDARY = 'source_native_afl_assets_no_user_or_fantasy_ownership' as const;
const RESPONSE_CONTRACT_VERSION = 'afl-trade-value/v2' as const;
const VALUATION_EXPORT_CONTRACT_VERSION = 'afl-trade-valuation-csv/v1' as const;
const PROJECTION_PUBLIC_EVIDENCE_INDEX_SCHEMA_VERSION =
  'afl-trade-projection-public-evidence-index/v1' as const;
const MAX_PUBLICATION_ENTRIES = 10_000;

const publicationManifestCommonShape = {
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
} as const;

const _aflTradePublicationManifestCommonContentSchema = z
  .object(publicationManifestCommonShape)
  .strict();

type PublicationCommon = z.infer<typeof _aflTradePublicationManifestCommonContentSchema>;

function addPublicationCommonIssues(manifest: PublicationCommon, context: z.RefinementCtx): void {
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
}

function viewsUseCanonicalOrder(views: readonly string[]): boolean {
  let previousIndex = -1;
  for (const view of views) {
    const index = AFL_TRADE_VALUATION_VIEWS.indexOf(
      view as (typeof AFL_TRADE_VALUATION_VIEWS)[number]
    );
    if (index <= previousIndex) return false;
    previousIndex = index;
  }
  return true;
}

export const aflTradeValuationOutputInventoryIndexBindingSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-valuation-output-inventory-index/v1'),
    valuationOutputInventoryIndexId: aflTradeContentAddressedIdSchema(
      'valuation-output-inventory-index'
    ),
    artifactRef: canonicalJsonArtifactRefSchema,
    entryCount: z.number().int().positive().max(MAX_PUBLICATION_ENTRIES),
    inventorySetSha256: aflTradeSha256Schema,
  })
  .strict();

export const aflTradeValuationOutputCustodyIndexBindingSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-valuation-output-custody-index/v1'),
    valuationOutputCustodyIndexId: aflTradeContentAddressedIdSchema(
      'valuation-output-custody-index'
    ),
    artifactRef: canonicalJsonArtifactRefSchema,
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    valuationOutputInventoryIndexId: aflTradeContentAddressedIdSchema(
      'valuation-output-inventory-index'
    ),
    inventorySetSha256: aflTradeSha256Schema,
    scopeKey: publicIdSchema,
    valueUnitId: publicIdSchema,
    entryCount: z.number().int().positive().max(MAX_PUBLICATION_ENTRIES),
    custodyReceiptSetSha256: aflTradeSha256Schema,
  })
  .strict();

export const aflTradePublicationFreshnessPolicyBindingSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-publication-freshness-policy/v1'),
    freshnessPolicyId: aflTradeContentAddressedIdSchema('freshness-policy'),
    artifactRef: canonicalJsonArtifactRefSchema,
  })
  .strict();

export const aflTradeProjectionPresentationPolicyBindingSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PROJECTION_PRESENTATION_POLICY_SCHEMA_VERSION),
    projectionPresentationPolicyId: aflTradeContentAddressedIdSchema(
      'projection-presentation-policy'
    ),
    artifactRef: canonicalJsonArtifactRefSchema,
    valueUnitId: publicIdSchema,
    universalLayer: aflTradeProjectionPresentationUniversalLayerSchema,
    supportedViews: z.tuple([
      z.literal('at_trade'),
      z.literal('realized'),
      z.literal('remaining'),
      z.literal('current'),
    ]),
  })
  .strict();

export const aflTradeProjectionPublicEvidenceIndexBindingSchema = z
  .object({
    schemaVersion: z.literal(PROJECTION_PUBLIC_EVIDENCE_INDEX_SCHEMA_VERSION),
    projectionPublicEvidenceIndexId: aflTradeContentAddressedIdSchema(
      'projection-public-evidence-index'
    ),
    artifactRef: canonicalJsonArtifactRefSchema,
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    valuationOutputInventoryIndexId: aflTradeContentAddressedIdSchema(
      'valuation-output-inventory-index'
    ),
    scopeKey: publicIdSchema,
    valueUnitId: publicIdSchema,
    indexedEvidenceSchemaVersion: z.literal(AFL_TRADE_PROJECTION_PUBLIC_EVIDENCE_SCHEMA_VERSION),
    entryCount: z.number().int().positive().max(MAX_PUBLICATION_ENTRIES),
    evidenceBindingSetSha256: aflTradeSha256Schema,
  })
  .strict();

export const aflTradePublicationManifestV2ContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-publication/v2'),
    ...publicationManifestCommonShape,
  })
  .strict()
  .superRefine(addPublicationCommonIssues);

export const aflTradePublicationManifestV3ContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-publication/v3'),
    ...publicationManifestCommonShape,
    publicAssetBoundary: z.literal(PUBLIC_ASSET_BOUNDARY),
    entryCount: z.number().int().positive().max(MAX_PUBLICATION_ENTRIES),
    valuationOutputInventoryIndex: aflTradeValuationOutputInventoryIndexBindingSchema,
    freshnessPolicy: aflTradePublicationFreshnessPolicyBindingSchema,
    projectionPresentationPolicy: aflTradeProjectionPresentationPolicyBindingSchema,
  })
  .strict()
  .superRefine(addPublicationCommonIssues)
  .superRefine((manifest, context) => {
    if (!viewsUseCanonicalOrder(manifest.supportedViews)) {
      context.addIssue({
        code: 'custom',
        path: ['supportedViews'],
        message: 'Publication v3 views must use canonical valuation-view order.',
      });
    }
    if (manifest.entryCount !== manifest.valuationOutputInventoryIndex.entryCount) {
      context.addIssue({
        code: 'custom',
        path: ['entryCount'],
        message: 'Publication entry count must match its detached inventory index.',
      });
    }
    if (
      manifest.projectionPresentationPolicy.valueUnitId !== manifest.valueUnitId ||
      !sameCanonicalJson(
        manifest.projectionPresentationPolicy.supportedViews,
        manifest.supportedViews
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionPresentationPolicy'],
        message: 'Publication presentation-policy coordinates must match the publication.',
      });
    }
    const createdAt = Date.parse(manifest.createdAt);
    const references = [
      manifest.publicationBundleArtifact,
      manifest.methodologyArtifact,
      manifest.validationReportArtifact,
      manifest.modelCardArtifact,
      manifest.valuationOutputInventoryIndex.artifactRef,
      manifest.freshnessPolicy.artifactRef,
      manifest.projectionPresentationPolicy.artifactRef,
    ];
    if (references.some((reference) => Date.parse(reference.createdAt) > createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'Publication v3 cannot predate any referenced immutable artifact.',
      });
    }
    if (
      Date.parse(manifest.publicationBundleArtifact.createdAt) <
      Date.parse(manifest.valuationOutputInventoryIndex.artifactRef.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['publicationBundleArtifact', 'createdAt'],
        message: 'Publication materialization cannot predate its detached inventory index.',
      });
    }
  });

export const aflTradePublicationManifestV4ContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-publication/v4'),
    ...publicationManifestCommonShape,
    publicAssetBoundary: z.literal(PUBLIC_ASSET_BOUNDARY),
    entryCount: z.number().int().positive().max(MAX_PUBLICATION_ENTRIES),
    valuationOutputInventoryIndex: aflTradeValuationOutputInventoryIndexBindingSchema,
    valuationOutputCustodyIndex: aflTradeValuationOutputCustodyIndexBindingSchema,
    freshnessPolicy: aflTradePublicationFreshnessPolicyBindingSchema,
    projectionPresentationPolicy: aflTradeProjectionPresentationPolicyBindingSchema,
  })
  .strict()
  .superRefine(addPublicationCommonIssues)
  .superRefine((manifest, context) => {
    const { valuationOutputCustodyIndex: custody, ...shared } = manifest;
    const v3 = aflTradePublicationManifestV3ContentSchema.safeParse({
      ...shared,
      schemaVersion: 'afl-trade-publication/v3',
    });
    if (!v3.success) {
      for (const issue of v3.error.issues) {
        context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      }
    }
    const inventory = manifest.valuationOutputInventoryIndex;
    if (
      custody.environment !== manifest.environment ||
      custody.valuationBundleId !== manifest.valuationBundleId ||
      custody.valuationOutputInventoryIndexId !== inventory.valuationOutputInventoryIndexId ||
      custody.inventorySetSha256 !== inventory.inventorySetSha256 ||
      custody.scopeKey !== manifest.scopeKey ||
      custody.valueUnitId !== manifest.valueUnitId ||
      custody.entryCount !== manifest.entryCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['valuationOutputCustodyIndex'],
        message:
          'Publication custody index must bind the exact environment, bundle, inventory, scope, value unit, and entry set.',
      });
    }
    if (
      Date.parse(custody.artifactRef.createdAt) > Date.parse(manifest.createdAt) ||
      Date.parse(custody.artifactRef.createdAt) >
        Date.parse(manifest.publicationBundleArtifact.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['valuationOutputCustodyIndex', 'artifactRef', 'createdAt'],
        message: 'Publication materialization cannot predate completed valuation-output custody.',
      });
    }
  });

function addPublicationContentAddressIssue(
  manifest: { publicationId: string; content: unknown },
  context: z.RefinementCtx
): void {
  addAflTradeContentAddressIssue('publication', manifest.publicationId, manifest.content, context, [
    'publicationId',
  ]);
}

export const aflTradePublicationManifestV2Schema = z
  .object({
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    content: aflTradePublicationManifestV2ContentSchema,
  })
  .strict()
  .superRefine(addPublicationContentAddressIssue);

export const aflTradePublicationManifestV3Schema = z
  .object({
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    content: aflTradePublicationManifestV3ContentSchema,
  })
  .strict()
  .superRefine(addPublicationContentAddressIssue);

export const aflTradePublicationManifestV4Schema = z
  .object({
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    content: aflTradePublicationManifestV4ContentSchema,
  })
  .strict()
  .superRefine(addPublicationContentAddressIssue);

export const aflTradePublicationManifestContentSchema = z.discriminatedUnion('schemaVersion', [
  aflTradePublicationManifestV2ContentSchema,
  aflTradePublicationManifestV3ContentSchema,
  aflTradePublicationManifestV4ContentSchema,
]);

export const aflTradePublicationManifestSchema = z.union([
  aflTradePublicationManifestV2Schema,
  aflTradePublicationManifestV3Schema,
  aflTradePublicationManifestV4Schema,
]);

export const aflTradeProjectionDocumentSetBindingSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-projection-document-set/v1'),
    projectionDocumentSetId: aflTradeContentAddressedIdSchema('projection-document-set'),
    artifactRef: canonicalJsonArtifactRefSchema,
    tradeCount: z.number().int().positive().max(MAX_PUBLICATION_ENTRIES),
    documentCount: z.number().int().positive(),
  })
  .strict();

export const aflTradeProjectionMaterializationBindingSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-projection-materialization/v1'),
    projectionMaterializationId: aflTradeContentAddressedIdSchema('projection-materialization'),
    artifactRef: canonicalJsonArtifactRefSchema,
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    valuationOutputInventoryIndexId: aflTradeContentAddressedIdSchema(
      'valuation-output-inventory-index'
    ),
    projectionPublicEvidenceIndexId: aflTradeContentAddressedIdSchema(
      'projection-public-evidence-index'
    ),
    projectionPresentationPolicyId: aflTradeContentAddressedIdSchema(
      'projection-presentation-policy'
    ),
    projectionSchemaBundleId: aflTradeContentAddressedIdSchema('projection-schema-bundle'),
    scopeKey: publicIdSchema,
    valueUnitId: publicIdSchema,
    calculationAsOf: isoDateTimeSchema,
    knowledgeCutoffAt: isoDateTimeSchema,
    tradeCount: z.number().int().positive().max(MAX_PUBLICATION_ENTRIES),
    documentCount: z
      .number()
      .int()
      .positive()
      .max(MAX_PUBLICATION_ENTRIES * 77),
    evidenceTradeSetSha256: aflTradeSha256Schema,
    entrySetSha256: aflTradeSha256Schema,
    shardSetSha256: aflTradeSha256Schema,
  })
  .strict()
  .superRefine((binding, context) => {
    if (
      binding.artifactRef.byteLength < 1 ||
      binding.artifactRef.byteLength > 512 * 1024 ||
      binding.documentCount < binding.tradeCount * 9 ||
      binding.documentCount > binding.tradeCount * 77 ||
      Date.parse(binding.knowledgeCutoffAt) > Date.parse(binding.calculationAsOf) ||
      Date.parse(binding.calculationAsOf) > Date.parse(binding.artifactRef.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Projection materialization binding must fit its root/lattice limits and preserve knowledge, calculation, and artifact chronology.',
      });
    }
  });

export type AflTradeProjectionMaterializationBinding = z.infer<
  typeof aflTradeProjectionMaterializationBindingSchema
>;

export const aflTradeProjectionSchemaBundleBindingSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-projection-schema-bundle/v1'),
    projectionSchemaBundleId: aflTradeContentAddressedIdSchema('projection-schema-bundle'),
    artifactRef: canonicalJsonArtifactRefSchema,
    responseContractVersion: z.literal(RESPONSE_CONTRACT_VERSION),
    valuationExportContractVersion: z.literal(VALUATION_EXPORT_CONTRACT_VERSION),
  })
  .strict();

export const aflTradeProjectionSchemaBundleV2BindingSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-projection-schema-bundle/v2'),
    projectionSchemaBundleId: aflTradeContentAddressedIdSchema('projection-schema-bundle'),
    artifactRef: canonicalJsonArtifactRefSchema,
    responseContractVersion: z.literal(RESPONSE_CONTRACT_VERSION),
    valuationExportContractVersion: z.literal(VALUATION_EXPORT_CONTRACT_VERSION),
    publicationManifestSchemaVersion: z.literal('afl-trade-publication/v4'),
    projectionManifestSchemaVersion: z.literal('afl-trade-projection/v3'),
  })
  .strict();

export const aflTradeAnyProjectionSchemaBundleBindingSchema = z.union([
  aflTradeProjectionSchemaBundleBindingSchema,
  aflTradeProjectionSchemaBundleV2BindingSchema,
]);

export const aflTradeProjectionParityReportBindingSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-projection-parity-report/v1'),
    projectionParityReportId: aflTradeContentAddressedIdSchema('projection-parity-report'),
    artifactRef: canonicalJsonArtifactRefSchema,
    status: z.literal('passed'),
    checkCount: z.number().int().positive(),
    failureCount: z.literal(0),
    checkedDocumentCount: z.number().int().positive(),
  })
  .strict();

export const aflTradeProjectionManifestV1ContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-projection/v1'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    createdAt: isoDateTimeSchema,
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    buildJobId: publicIdSchema,
    responseContractVersion: z.literal(RESPONSE_CONTRACT_VERSION),
    documentCount: z.number().int().nonnegative(),
    projectionArtifact: aflTradeArtifactRefSchema,
    schemaArtifact: aflTradeArtifactRefSchema,
    parityReportArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

export const aflTradeProjectionManifestV2ContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-projection/v2'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    createdAt: isoDateTimeSchema,
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    buildJobId: publicIdSchema,
    publicAssetBoundary: z.literal(PUBLIC_ASSET_BOUNDARY),
    responseContractVersion: z.literal(RESPONSE_CONTRACT_VERSION),
    valuationExportContractVersion: z.literal(VALUATION_EXPORT_CONTRACT_VERSION),
    valueUnitId: publicIdSchema,
    supportedViews: z.array(z.enum(AFL_TRADE_VALUATION_VIEWS)).min(1),
    documentCount: z.number().int().positive(),
    valuationOutputInventoryIndex: aflTradeValuationOutputInventoryIndexBindingSchema,
    freshnessPolicy: aflTradePublicationFreshnessPolicyBindingSchema,
    projectionPresentationPolicy: aflTradeProjectionPresentationPolicyBindingSchema,
    projectionPublicEvidenceIndex: aflTradeProjectionPublicEvidenceIndexBindingSchema,
    projectionMaterialization: aflTradeProjectionMaterializationBindingSchema,
    projectionDocumentSet: aflTradeProjectionDocumentSetBindingSchema,
    projectionSchemaBundle: aflTradeProjectionSchemaBundleBindingSchema,
    parityReport: aflTradeProjectionParityReportBindingSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      new Set(manifest.supportedViews).size !== manifest.supportedViews.length ||
      !viewsUseCanonicalOrder(manifest.supportedViews)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['supportedViews'],
        message: 'Projection v2 views must be unique and use canonical valuation-view order.',
      });
    }
    if (manifest.documentCount !== manifest.projectionDocumentSet.documentCount) {
      context.addIssue({
        code: 'custom',
        path: ['documentCount'],
        message: 'Projection document count must match its document-set root.',
      });
    }
    if (
      manifest.projectionDocumentSet.tradeCount !==
        manifest.valuationOutputInventoryIndex.entryCount ||
      manifest.projectionPublicEvidenceIndex.entryCount !==
        manifest.valuationOutputInventoryIndex.entryCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocumentSet', 'tradeCount'],
        message: 'Projection trade count must match its detached inventory index.',
      });
    }
    if (
      manifest.projectionPresentationPolicy.valueUnitId !== manifest.valueUnitId ||
      !sameCanonicalJson(
        manifest.projectionPresentationPolicy.supportedViews,
        manifest.supportedViews
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionPresentationPolicy'],
        message: 'Projection presentation-policy coordinates must match the projection.',
      });
    }
    if (
      manifest.projectionPublicEvidenceIndex.publicationId !== manifest.publicationId ||
      manifest.projectionPublicEvidenceIndex.valuationOutputInventoryIndexId !==
        manifest.valuationOutputInventoryIndex.valuationOutputInventoryIndexId ||
      manifest.projectionPublicEvidenceIndex.scopeKey !== manifest.scopeKey ||
      manifest.projectionPublicEvidenceIndex.valueUnitId !== manifest.valueUnitId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionPublicEvidenceIndex'],
        message: 'Projection public-evidence-index coordinates must match the projection.',
      });
    }
    if (
      manifest.projectionMaterialization.publicationId !== manifest.publicationId ||
      manifest.projectionMaterialization.valuationOutputInventoryIndexId !==
        manifest.valuationOutputInventoryIndex.valuationOutputInventoryIndexId ||
      manifest.projectionMaterialization.projectionPublicEvidenceIndexId !==
        manifest.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId ||
      manifest.projectionMaterialization.projectionPresentationPolicyId !==
        manifest.projectionPresentationPolicy.projectionPresentationPolicyId ||
      manifest.projectionMaterialization.projectionSchemaBundleId !==
        manifest.projectionSchemaBundle.projectionSchemaBundleId ||
      manifest.projectionMaterialization.scopeKey !== manifest.scopeKey ||
      manifest.projectionMaterialization.valueUnitId !== manifest.valueUnitId ||
      manifest.projectionMaterialization.tradeCount !==
        manifest.valuationOutputInventoryIndex.entryCount ||
      manifest.projectionMaterialization.documentCount + 1 !== manifest.documentCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionMaterialization'],
        message:
          'Projection materialization must bind the exact publication, index, evidence, policy, schema, scope, unit, and document lattice.',
      });
    }
    if (manifest.parityReport.checkedDocumentCount !== manifest.documentCount) {
      context.addIssue({
        code: 'custom',
        path: ['parityReport', 'checkedDocumentCount'],
        message: 'Passing parity must cover every projection document.',
      });
    }
    if (
      manifest.projectionSchemaBundle.responseContractVersion !==
        manifest.responseContractVersion ||
      manifest.projectionSchemaBundle.valuationExportContractVersion !==
        manifest.valuationExportContractVersion
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionSchemaBundle'],
        message: 'Projection schema-bundle contracts must match the manifest contracts.',
      });
    }

    const indexCreatedAt = Date.parse(manifest.valuationOutputInventoryIndex.artifactRef.createdAt);
    const freshnessCreatedAt = Date.parse(manifest.freshnessPolicy.artifactRef.createdAt);
    const policyCreatedAt = Date.parse(manifest.projectionPresentationPolicy.artifactRef.createdAt);
    const evidenceIndexCreatedAt = Date.parse(
      manifest.projectionPublicEvidenceIndex.artifactRef.createdAt
    );
    const materializationCreatedAt = Date.parse(
      manifest.projectionMaterialization.artifactRef.createdAt
    );
    const schemaCreatedAt = Date.parse(manifest.projectionSchemaBundle.artifactRef.createdAt);
    const documentSetCreatedAt = Date.parse(manifest.projectionDocumentSet.artifactRef.createdAt);
    const parityCreatedAt = Date.parse(manifest.parityReport.artifactRef.createdAt);
    const projectionCreatedAt = Date.parse(manifest.createdAt);
    if (
      indexCreatedAt > documentSetCreatedAt ||
      schemaCreatedAt > documentSetCreatedAt ||
      policyCreatedAt > documentSetCreatedAt ||
      evidenceIndexCreatedAt > documentSetCreatedAt ||
      materializationCreatedAt > documentSetCreatedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionDocumentSet', 'artifactRef', 'createdAt'],
        message:
          'Projection documents cannot predate their inventory index, schema bundle, presentation policy, public-evidence index, or materialization root.',
      });
    }
    if (
      documentSetCreatedAt > parityCreatedAt ||
      schemaCreatedAt > parityCreatedAt ||
      policyCreatedAt > parityCreatedAt ||
      evidenceIndexCreatedAt > parityCreatedAt ||
      materializationCreatedAt > parityCreatedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['parityReport', 'artifactRef', 'createdAt'],
        message:
          'Parity verification cannot predate projection documents, schemas, presentation policy, public evidence, or materialization.',
      });
    }
    if (parityCreatedAt !== projectionCreatedAt) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'Projection v2 creation time must exactly equal its passing parity artifact time.',
      });
    }
    if (
      parityCreatedAt > projectionCreatedAt ||
      freshnessCreatedAt > projectionCreatedAt ||
      policyCreatedAt > projectionCreatedAt ||
      evidenceIndexCreatedAt > projectionCreatedAt ||
      indexCreatedAt > projectionCreatedAt ||
      schemaCreatedAt > projectionCreatedAt ||
      materializationCreatedAt > projectionCreatedAt ||
      documentSetCreatedAt > projectionCreatedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'Projection v2 cannot predate any referenced immutable artifact.',
      });
    }
  });

export const aflTradeProjectionManifestV3ContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-projection/v3'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    createdAt: isoDateTimeSchema,
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    buildJobId: publicIdSchema,
    publicAssetBoundary: z.literal(PUBLIC_ASSET_BOUNDARY),
    responseContractVersion: z.literal(RESPONSE_CONTRACT_VERSION),
    valuationExportContractVersion: z.literal(VALUATION_EXPORT_CONTRACT_VERSION),
    valueUnitId: publicIdSchema,
    supportedViews: z.array(z.enum(AFL_TRADE_VALUATION_VIEWS)).min(1),
    documentCount: z.number().int().positive(),
    valuationOutputInventoryIndex: aflTradeValuationOutputInventoryIndexBindingSchema,
    valuationOutputCustodyIndex: aflTradeValuationOutputCustodyIndexBindingSchema,
    freshnessPolicy: aflTradePublicationFreshnessPolicyBindingSchema,
    projectionPresentationPolicy: aflTradeProjectionPresentationPolicyBindingSchema,
    projectionPublicEvidenceIndex: aflTradeProjectionPublicEvidenceIndexBindingSchema,
    projectionMaterialization: aflTradeProjectionMaterializationBindingSchema,
    projectionDocumentSet: aflTradeProjectionDocumentSetBindingSchema,
    projectionSchemaBundle: aflTradeProjectionSchemaBundleV2BindingSchema,
    parityReport: aflTradeProjectionParityReportBindingSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const {
      valuationOutputCustodyIndex: custody,
      projectionSchemaBundle: schemaBundle,
      ...shared
    } = manifest;
    const v2 = aflTradeProjectionManifestV2ContentSchema.safeParse({
      ...shared,
      schemaVersion: 'afl-trade-projection/v2',
      projectionSchemaBundle: {
        schemaVersion: 'afl-trade-projection-schema-bundle/v1',
        projectionSchemaBundleId: schemaBundle.projectionSchemaBundleId,
        artifactRef: schemaBundle.artifactRef,
        responseContractVersion: schemaBundle.responseContractVersion,
        valuationExportContractVersion: schemaBundle.valuationExportContractVersion,
      },
    });
    if (!v2.success) {
      for (const issue of v2.error.issues) {
        context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      }
    }
    const inventory = manifest.valuationOutputInventoryIndex;
    if (
      custody.environment !== manifest.environment ||
      custody.valuationOutputInventoryIndexId !== inventory.valuationOutputInventoryIndexId ||
      custody.inventorySetSha256 !== inventory.inventorySetSha256 ||
      custody.scopeKey !== manifest.scopeKey ||
      custody.valueUnitId !== manifest.valueUnitId ||
      custody.entryCount !== manifest.projectionDocumentSet.tradeCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['valuationOutputCustodyIndex'],
        message:
          'Projection custody index must bind the exact environment, inventory, scope, value unit, and trade set.',
      });
    }
    if (
      Date.parse(custody.artifactRef.createdAt) >
        Date.parse(manifest.projectionDocumentSet.artifactRef.createdAt) ||
      Date.parse(custody.artifactRef.createdAt) > Date.parse(manifest.createdAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['valuationOutputCustodyIndex', 'artifactRef', 'createdAt'],
        message: 'Projection documents cannot predate completed valuation-output custody.',
      });
    }
  });

function addProjectionContentAddressIssue(
  manifest: { projectionId: string; content: unknown },
  context: z.RefinementCtx
): void {
  addAflTradeContentAddressIssue('projection', manifest.projectionId, manifest.content, context, [
    'projectionId',
  ]);
}

export const aflTradeProjectionManifestV1Schema = z
  .object({
    projectionId: aflTradeContentAddressedIdSchema('projection'),
    content: aflTradeProjectionManifestV1ContentSchema,
  })
  .strict()
  .superRefine(addProjectionContentAddressIssue);

export const aflTradeProjectionManifestV2Schema = z
  .object({
    projectionId: aflTradeContentAddressedIdSchema('projection'),
    content: aflTradeProjectionManifestV2ContentSchema,
  })
  .strict()
  .superRefine(addProjectionContentAddressIssue);

export const aflTradeProjectionManifestV3Schema = z
  .object({
    projectionId: aflTradeContentAddressedIdSchema('projection'),
    content: aflTradeProjectionManifestV3ContentSchema,
  })
  .strict()
  .superRefine(addProjectionContentAddressIssue);

export const aflTradeProjectionManifestContentSchema = z.discriminatedUnion('schemaVersion', [
  aflTradeProjectionManifestV1ContentSchema,
  aflTradeProjectionManifestV2ContentSchema,
  aflTradeProjectionManifestV3ContentSchema,
]);

export const aflTradeProjectionManifestSchema = z.union([
  aflTradeProjectionManifestV1Schema,
  aflTradeProjectionManifestV2Schema,
  aflTradeProjectionManifestV3Schema,
]);

export type AflTradePublicationManifestV2Content = z.infer<
  typeof aflTradePublicationManifestV2ContentSchema
>;
export type AflTradePublicationManifestV3Content = z.infer<
  typeof aflTradePublicationManifestV3ContentSchema
>;
export type AflTradePublicationManifestV4Content = z.infer<
  typeof aflTradePublicationManifestV4ContentSchema
>;
export type AflTradePublicationManifestV2 = z.infer<typeof aflTradePublicationManifestV2Schema>;
export type AflTradePublicationManifestV3 = z.infer<typeof aflTradePublicationManifestV3Schema>;
export type AflTradePublicationManifestV4 = z.infer<typeof aflTradePublicationManifestV4Schema>;
export type AflTradePublicationManifest = z.infer<typeof aflTradePublicationManifestSchema>;

export type AflTradeProjectionManifestV1Content = z.infer<
  typeof aflTradeProjectionManifestV1ContentSchema
>;
export type AflTradeProjectionManifestV2Content = z.infer<
  typeof aflTradeProjectionManifestV2ContentSchema
>;
export type AflTradeProjectionManifestV3Content = z.infer<
  typeof aflTradeProjectionManifestV3ContentSchema
>;
export type AflTradeProjectionManifestV1 = z.infer<typeof aflTradeProjectionManifestV1Schema>;
export type AflTradeProjectionManifestV2 = z.infer<typeof aflTradeProjectionManifestV2Schema>;
export type AflTradeProjectionManifestV3 = z.infer<typeof aflTradeProjectionManifestV3Schema>;
export type AflTradeProjectionManifest = z.infer<typeof aflTradeProjectionManifestSchema>;

export const aflTradePublicationProjectionManifestPairSchema = z.union([
  z
    .object({
      publicationManifest: aflTradePublicationManifestV3Schema,
      projectionManifest: aflTradeProjectionManifestV2Schema,
    })
    .strict(),
  z
    .object({
      publicationManifest: aflTradePublicationManifestV4Schema,
      projectionManifest: aflTradeProjectionManifestV3Schema,
    })
    .strict(),
]);

export type AflTradePublicationProjectionManifestPair = z.infer<
  typeof aflTradePublicationProjectionManifestPairSchema
>;

export const AFL_TRADE_PUBLICATION_PROJECTION_PAIR_ISSUE_CODES = [
  'INVALID_INPUT',
  'UNSUPPORTED_VERSION_PAIR',
  'PUBLICATION_MISMATCH',
  'ENVIRONMENT_MISMATCH',
  'SCOPE_MISMATCH',
  'PUBLIC_ASSET_BOUNDARY_MISMATCH',
  'VALUE_UNIT_MISMATCH',
  'SUPPORTED_VIEW_MISMATCH',
  'INVENTORY_INDEX_MISMATCH',
  'CUSTODY_INDEX_MISMATCH',
  'FRESHNESS_POLICY_MISMATCH',
  'PRESENTATION_POLICY_MISMATCH',
  'PUBLIC_EVIDENCE_INDEX_PUBLICATION_MISMATCH',
  'PUBLIC_EVIDENCE_INDEX_INVENTORY_MISMATCH',
  'PUBLIC_EVIDENCE_INDEX_SCOPE_MISMATCH',
  'PUBLIC_EVIDENCE_INDEX_VALUE_UNIT_MISMATCH',
  'PUBLIC_EVIDENCE_INDEX_COUNT_MISMATCH',
  'MATERIALIZATION_MISMATCH',
  'ENTRY_COUNT_MISMATCH',
  'DOCUMENT_COUNT_MISMATCH',
  'RESPONSE_CONTRACT_MISMATCH',
  'EXPORT_CONTRACT_MISMATCH',
  'CHRONOLOGY_INVALID',
] as const;

export type AflTradePublicationProjectionPairIssueCode =
  (typeof AFL_TRADE_PUBLICATION_PROJECTION_PAIR_ISSUE_CODES)[number];

export interface AflTradePublicationProjectionPairIssue {
  code: AflTradePublicationProjectionPairIssueCode;
  message: string;
}

export interface AflTradePublicationProjectionPairValidation {
  valid: boolean;
  issues: readonly AflTradePublicationProjectionPairIssue[];
}

const PAIR_ISSUE_MESSAGES: Readonly<Record<AflTradePublicationProjectionPairIssueCode, string>> =
  Object.freeze({
    INVALID_INPUT: 'The publication-projection pair input is invalid.',
    UNSUPPORTED_VERSION_PAIR:
      'Serving requires publication v4 with projection v3, or the retained publication v3 with projection v2 pair.',
    PUBLICATION_MISMATCH: 'The projection does not bind the selected publication.',
    ENVIRONMENT_MISMATCH: 'Publication and projection environments do not match.',
    SCOPE_MISMATCH: 'Publication and projection scopes do not match.',
    PUBLIC_ASSET_BOUNDARY_MISMATCH:
      'Publication and projection do not share the source-native AFL asset boundary.',
    VALUE_UNIT_MISMATCH: 'Publication and projection value units do not match.',
    SUPPORTED_VIEW_MISMATCH: 'Publication and projection supported views do not match.',
    INVENTORY_INDEX_MISMATCH:
      'Publication and projection do not bind the same detached inventory index.',
    CUSTODY_INDEX_MISMATCH:
      'Publication and projection do not bind the same completed valuation-output custody set.',
    FRESHNESS_POLICY_MISMATCH: 'Publication and projection do not bind the same freshness policy.',
    PRESENTATION_POLICY_MISMATCH:
      'Publication and projection do not bind the same presentation policy.',
    PUBLIC_EVIDENCE_INDEX_PUBLICATION_MISMATCH:
      'The public-evidence index does not bind the selected publication.',
    PUBLIC_EVIDENCE_INDEX_INVENTORY_MISMATCH:
      'The public-evidence index does not bind the publication inventory index.',
    PUBLIC_EVIDENCE_INDEX_SCOPE_MISMATCH:
      'The public-evidence index scope does not match the publication scope.',
    PUBLIC_EVIDENCE_INDEX_VALUE_UNIT_MISMATCH:
      'The public-evidence index value unit does not match the publication value unit.',
    PUBLIC_EVIDENCE_INDEX_COUNT_MISMATCH:
      'The public-evidence index count does not match the publication entry count.',
    MATERIALIZATION_MISMATCH:
      'The projection materialization does not bind the selected publication and its exact analytical parents.',
    ENTRY_COUNT_MISMATCH: 'Publication, inventory, and document-set trade counts do not match.',
    DOCUMENT_COUNT_MISMATCH: 'Projection document and parity counts do not match.',
    RESPONSE_CONTRACT_MISMATCH: 'Projection response-contract declarations do not match.',
    EXPORT_CONTRACT_MISMATCH: 'Projection export-contract declarations do not match.',
    CHRONOLOGY_INVALID: 'The projection manifest predates its publication.',
  });

const PAIR_INPUT_KEYS = ['publicationManifest', 'projectionManifest'] as const;
type PairInputKey = (typeof PAIR_INPUT_KEYS)[number];
type PairInputSnapshot = Record<PairInputKey, unknown>;
const PAIR_INPUT_KEY_SET = new Set<string>(PAIR_INPUT_KEYS);

function snapshotPairInput(value: unknown): PairInputSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    if (nodeUtilTypes.isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== PAIR_INPUT_KEYS.length ||
      keys.some((key) => typeof key !== 'string' || !PAIR_INPUT_KEY_SET.has(key))
    ) {
      return null;
    }
    const snapshot = Object.create(null) as PairInputSnapshot;
    for (const key of PAIR_INPUT_KEYS) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || 'get' in descriptor || descriptor.enumerable !== true) {
        return null;
      }
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function pairValidation(
  issues: readonly AflTradePublicationProjectionPairIssue[]
): AflTradePublicationProjectionPairValidation {
  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze([...issues]),
  });
}

function singlePairIssue(
  code: AflTradePublicationProjectionPairIssueCode
): AflTradePublicationProjectionPairValidation {
  return pairValidation([Object.freeze({ code, message: PAIR_ISSUE_MESSAGES[code] })]);
}

function addPairIssue(
  issues: AflTradePublicationProjectionPairIssue[],
  code: AflTradePublicationProjectionPairIssueCode
): void {
  issues.push(Object.freeze({ code, message: PAIR_ISSUE_MESSAGES[code] }));
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

export function validateAflTradePublicationProjectionManifestPair(
  input: unknown
): AflTradePublicationProjectionPairValidation {
  try {
    const snapshot = snapshotPairInput(input);
    if (snapshot === null) return singlePairIssue('INVALID_INPUT');
    const genericPublication = aflTradePublicationManifestSchema.safeParse(
      snapshot.publicationManifest
    );
    const genericProjection = aflTradeProjectionManifestSchema.safeParse(
      snapshot.projectionManifest
    );
    if (!genericPublication.success || !genericProjection.success) {
      return singlePairIssue('INVALID_INPUT');
    }
    const versionPair = `${genericPublication.data.content.schemaVersion}|${genericProjection.data.content.schemaVersion}`;
    if (
      versionPair !== 'afl-trade-publication/v3|afl-trade-projection/v2' &&
      versionPair !== 'afl-trade-publication/v4|afl-trade-projection/v3'
    ) {
      return singlePairIssue('UNSUPPORTED_VERSION_PAIR');
    }
    const pair = aflTradePublicationProjectionManifestPairSchema.safeParse({
      publicationManifest: genericPublication.data,
      projectionManifest: genericProjection.data,
    });
    if (!pair.success) return singlePairIssue('INVALID_INPUT');

    const publicationContent = pair.data.publicationManifest.content;
    const projectionContent = pair.data.projectionManifest.content;
    const issues: AflTradePublicationProjectionPairIssue[] = [];
    if (projectionContent.publicationId !== pair.data.publicationManifest.publicationId) {
      addPairIssue(issues, 'PUBLICATION_MISMATCH');
    }
    if (projectionContent.environment !== publicationContent.environment) {
      addPairIssue(issues, 'ENVIRONMENT_MISMATCH');
    }
    if (projectionContent.scopeKey !== publicationContent.scopeKey) {
      addPairIssue(issues, 'SCOPE_MISMATCH');
    }
    if (projectionContent.publicAssetBoundary !== publicationContent.publicAssetBoundary) {
      addPairIssue(issues, 'PUBLIC_ASSET_BOUNDARY_MISMATCH');
    }
    if (projectionContent.valueUnitId !== publicationContent.valueUnitId) {
      addPairIssue(issues, 'VALUE_UNIT_MISMATCH');
    }
    if (!sameCanonicalJson(projectionContent.supportedViews, publicationContent.supportedViews)) {
      addPairIssue(issues, 'SUPPORTED_VIEW_MISMATCH');
    }
    if (
      !sameCanonicalJson(
        projectionContent.valuationOutputInventoryIndex,
        publicationContent.valuationOutputInventoryIndex
      )
    ) {
      addPairIssue(issues, 'INVENTORY_INDEX_MISMATCH');
    }
    if (
      publicationContent.schemaVersion === 'afl-trade-publication/v4' &&
      projectionContent.schemaVersion === 'afl-trade-projection/v3' &&
      !sameCanonicalJson(
        projectionContent.valuationOutputCustodyIndex,
        publicationContent.valuationOutputCustodyIndex
      )
    ) {
      addPairIssue(issues, 'CUSTODY_INDEX_MISMATCH');
    }
    if (!sameCanonicalJson(projectionContent.freshnessPolicy, publicationContent.freshnessPolicy)) {
      addPairIssue(issues, 'FRESHNESS_POLICY_MISMATCH');
    }
    if (
      !sameCanonicalJson(
        projectionContent.projectionPresentationPolicy,
        publicationContent.projectionPresentationPolicy
      )
    ) {
      addPairIssue(issues, 'PRESENTATION_POLICY_MISMATCH');
    }
    if (
      projectionContent.projectionPublicEvidenceIndex.publicationId !==
      pair.data.publicationManifest.publicationId
    ) {
      addPairIssue(issues, 'PUBLIC_EVIDENCE_INDEX_PUBLICATION_MISMATCH');
    }
    if (
      projectionContent.projectionPublicEvidenceIndex.valuationOutputInventoryIndexId !==
      publicationContent.valuationOutputInventoryIndex.valuationOutputInventoryIndexId
    ) {
      addPairIssue(issues, 'PUBLIC_EVIDENCE_INDEX_INVENTORY_MISMATCH');
    }
    if (projectionContent.projectionPublicEvidenceIndex.scopeKey !== publicationContent.scopeKey) {
      addPairIssue(issues, 'PUBLIC_EVIDENCE_INDEX_SCOPE_MISMATCH');
    }
    if (
      projectionContent.projectionPublicEvidenceIndex.valueUnitId !== publicationContent.valueUnitId
    ) {
      addPairIssue(issues, 'PUBLIC_EVIDENCE_INDEX_VALUE_UNIT_MISMATCH');
    }
    if (
      projectionContent.projectionPublicEvidenceIndex.entryCount !== publicationContent.entryCount
    ) {
      addPairIssue(issues, 'PUBLIC_EVIDENCE_INDEX_COUNT_MISMATCH');
    }
    const materialization = projectionContent.projectionMaterialization;
    if (
      materialization.publicationId !== pair.data.publicationManifest.publicationId ||
      materialization.valuationOutputInventoryIndexId !==
        publicationContent.valuationOutputInventoryIndex.valuationOutputInventoryIndexId ||
      materialization.projectionPublicEvidenceIndexId !==
        projectionContent.projectionPublicEvidenceIndex.projectionPublicEvidenceIndexId ||
      materialization.projectionPresentationPolicyId !==
        publicationContent.projectionPresentationPolicy.projectionPresentationPolicyId ||
      materialization.projectionSchemaBundleId !==
        projectionContent.projectionSchemaBundle.projectionSchemaBundleId ||
      materialization.scopeKey !== publicationContent.scopeKey ||
      materialization.valueUnitId !== publicationContent.valueUnitId
    ) {
      addPairIssue(issues, 'MATERIALIZATION_MISMATCH');
    }
    if (
      publicationContent.entryCount !==
        projectionContent.valuationOutputInventoryIndex.entryCount ||
      publicationContent.entryCount !==
        projectionContent.projectionPublicEvidenceIndex.entryCount ||
      publicationContent.entryCount !== projectionContent.projectionDocumentSet.tradeCount ||
      publicationContent.entryCount !== materialization.tradeCount
    ) {
      addPairIssue(issues, 'ENTRY_COUNT_MISMATCH');
    }
    if (
      projectionContent.documentCount !== projectionContent.projectionDocumentSet.documentCount ||
      projectionContent.documentCount !== projectionContent.parityReport.checkedDocumentCount ||
      projectionContent.documentCount !== materialization.documentCount + 1
    ) {
      addPairIssue(issues, 'DOCUMENT_COUNT_MISMATCH');
    }
    if (
      projectionContent.responseContractVersion !==
      projectionContent.projectionSchemaBundle.responseContractVersion
    ) {
      addPairIssue(issues, 'RESPONSE_CONTRACT_MISMATCH');
    }
    if (
      projectionContent.valuationExportContractVersion !==
      projectionContent.projectionSchemaBundle.valuationExportContractVersion
    ) {
      addPairIssue(issues, 'EXPORT_CONTRACT_MISMATCH');
    }
    if (
      Date.parse(projectionContent.createdAt) < Date.parse(publicationContent.createdAt) ||
      Date.parse(projectionContent.projectionPublicEvidenceIndex.artifactRef.createdAt) <
        Date.parse(publicationContent.createdAt) ||
      Date.parse(materialization.artifactRef.createdAt) <
        Date.parse(publicationContent.createdAt) ||
      Date.parse(projectionContent.projectionDocumentSet.artifactRef.createdAt) <
        Date.parse(publicationContent.createdAt)
    ) {
      addPairIssue(issues, 'CHRONOLOGY_INVALID');
    }
    return pairValidation(issues);
  } catch {
    return singlePairIssue('INVALID_INPUT');
  }
}
