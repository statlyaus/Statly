import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { aflTradeArtifactReadbackReceiptSchema } from '../artifacts/immutableArtifactRepository';
import {
  aflTradeValuationOutputInventoryIndexVerifyInputSchema,
  verifyAflTradeValuationOutputInventoryIndex,
} from '../artifacts/valuationOutputInventoryIndex';
import {
  aflTradePublicationManifestV3Schema,
  aflTradePublicationManifestV4Schema,
} from '../artifacts/publicationProjectionManifests';
import { compareAflTradeCodeUnits } from './deterministicProbabilityMeasure';
import { aflTradeValuationOutputCustodyReceiptSchema } from './valuationOutputCustody';

export const AFL_TRADE_VALUATION_OUTPUT_CUSTODY_INDEX_SCHEMA_VERSION =
  'afl-trade-valuation-output-custody-index/v1' as const;

const canonicalArtifactRefSchema = aflTradeArtifactRefSchema.refine(
  ({ mediaType }) => mediaType === 'application/json',
  'Custody-index evidence must use canonical JSON artifacts.'
);

const custodyEvidenceSchema = z.object({
  receipt: aflTradeValuationOutputCustodyReceiptSchema,
  receiptArtifactRef: canonicalArtifactRefSchema,
  receiptReadback: aflTradeArtifactReadbackReceiptSchema,
  receiptReadbackArtifactRef: canonicalArtifactRefSchema,
});

export const aflTradeValuationOutputCustodyIndexEntrySchema = z
  .object({
    tradeId: z.string().trim().min(1).max(200),
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    valuationOutputInventoryId: aflTradeContentAddressedIdSchema('valuation-output-inventory'),
    inventoryArtifactRef: canonicalArtifactRefSchema,
    operationId: aflTradeContentAddressedIdSchema('valuation-output-custody-operation'),
    receiptId: aflTradeContentAddressedIdSchema('valuation-output-custody'),
    receiptArtifactRef: canonicalArtifactRefSchema,
    receiptReadbackArtifactRef: canonicalArtifactRefSchema,
    verifiedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const aflTradeValuationOutputCustodyIndexContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_OUTPUT_CUSTODY_INDEX_SCHEMA_VERSION),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    valuationOutputInventoryIndex: z
      .object({
        valuationOutputInventoryIndexId: aflTradeContentAddressedIdSchema(
          'valuation-output-inventory-index'
        ),
        artifactRef: canonicalArtifactRefSchema,
        inventorySetSha256: aflTradeSha256Schema,
      })
      .strict(),
    scopeKey: z.string().trim().min(1).max(200),
    valueUnitId: z.string().trim().min(1).max(200),
    ordering: z.literal('trade_id_code_unit_ascending'),
    entryCount: z.number().int().positive().max(10_000),
    custodyReceiptSetSha256: aflTradeSha256Schema,
    entries: z.array(aflTradeValuationOutputCustodyIndexEntrySchema).min(1).max(10_000),
    createdAt: z.iso.datetime({ offset: true }),
    verification: z.literal('exact_inventory_index_to_completed_custody_set'),
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.entryCount !== content.entries.length) {
      context.addIssue({
        code: 'custom',
        path: ['entryCount'],
        message: 'Custody-index entry count must match its exact receipt set.',
      });
    }
    const canonical = content.entries.every(
      (entry, index) =>
        index === 0 ||
        compareAflTradeCodeUnits(content.entries[index - 1].tradeId, entry.tradeId) < 0
    );
    if (!canonical) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Custody-index entries require unique canonical trade ordering.',
      });
    }
    for (const values of [
      content.entries.map(({ valuationOutputInventoryId }) => valuationOutputInventoryId),
      content.entries.map(({ operationId }) => operationId),
      content.entries.map(({ receiptId }) => receiptId),
      content.entries.map(({ receiptArtifactRef }) => receiptArtifactRef.artifactId),
    ]) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: 'custom',
          path: ['entries'],
          message: 'Custody-index identities must be unique.',
        });
      }
    }
    if (content.custodyReceiptSetSha256 !== sha256AflTradeCanonicalJson(content.entries)) {
      context.addIssue({
        code: 'custom',
        path: ['custodyReceiptSetSha256'],
        message: 'Custody-index digest must authenticate the ordered receipt set.',
      });
    }
    if (
      content.entries.some(
        ({ verifiedAt, receiptArtifactRef, receiptReadbackArtifactRef }) =>
          Date.parse(verifiedAt) > Date.parse(content.createdAt) ||
          Date.parse(receiptArtifactRef.createdAt) > Date.parse(content.createdAt) ||
          Date.parse(receiptReadbackArtifactRef.createdAt) > Date.parse(content.createdAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'Custody index cannot predate any completed receipt evidence.',
      });
    }
  });

export const aflTradeValuationOutputCustodyIndexSchema = z
  .object({
    valuationOutputCustodyIndexId: aflTradeContentAddressedIdSchema(
      'valuation-output-custody-index'
    ),
    content: aflTradeValuationOutputCustodyIndexContentSchema,
  })
  .strict()
  .superRefine((index, context) => {
    addAflTradeContentAddressIssue(
      'valuation-output-custody-index',
      index.valuationOutputCustodyIndexId,
      index.content,
      context,
      ['valuationOutputCustodyIndexId']
    );
  });

export const aflTradeValuationOutputCustodyIndexResultSchema = z
  .object({
    valuationOutputCustodyIndex: aflTradeValuationOutputCustodyIndexSchema,
    artifactRef: canonicalArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      !doesAflTradeArtifactRefMatchCanonicalJson(
        result.artifactRef,
        result.valuationOutputCustodyIndex
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['artifactRef'],
        message: 'Custody-index artifact must authenticate the complete index.',
      });
    }
  });

export type AflTradeValuationOutputCustodyIndexResult = z.infer<
  typeof aflTradeValuationOutputCustodyIndexResultSchema
>;

const createInputSchema = z
  .object({
    inventoryIndexVerification: aflTradeValuationOutputInventoryIndexVerifyInputSchema,
    custodyReceipts: z.array(custodyEvidenceSchema).min(1).max(10_000),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const aflTradeValuationOutputCustodyIndexVerificationSchema = createInputSchema
  .extend({ output: aflTradeValuationOutputCustodyIndexResultSchema })
  .strict();

export const aflTradeCustodiedPublicationManifestResultSchema = z
  .object({
    publicationManifest: aflTradePublicationManifestV4Schema,
    artifactRef: canonicalArtifactRefSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      !doesAflTradeArtifactRefMatchCanonicalJson(result.artifactRef, result.publicationManifest)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['artifactRef'],
        message: 'Custodied publication artifact must authenticate the complete v4 manifest.',
      });
    }
  });

export type AflTradeCustodiedPublicationManifestResult = z.infer<
  typeof aflTradeCustodiedPublicationManifestResultSchema
>;

const custodiedPublicationInputSchema = z
  .object({
    publicationCandidate: aflTradePublicationManifestV3Schema,
    custodyIndexVerification: aflTradeValuationOutputCustodyIndexVerificationSchema,
  })
  .strict();

function fail(message: string): never {
  throw new Error(`Valuation-output custody index rejected input: ${message}`);
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function snapshot(value: unknown): unknown {
  return structuredClone(value);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

export function createAflTradeValuationOutputCustodyIndex(
  unparsedInput: unknown
): AflTradeValuationOutputCustodyIndexResult {
  let input: z.infer<typeof createInputSchema>;
  try {
    input = createInputSchema.parse(snapshot(unparsedInput));
  } catch {
    return fail('invalid exact input envelope');
  }
  if (!verifyAflTradeValuationOutputInventoryIndex(input.inventoryIndexVerification)) {
    return fail('inventory index does not replay exactly');
  }
  const index = input.inventoryIndexVerification.output;
  const indexContent = index.valuationOutputInventoryIndex.content;
  const bundle = input.inventoryIndexVerification.valuationBundleManifest;
  const evidenceByInventory = new Map(
    input.custodyReceipts.map((evidence) => [
      evidence.receipt.content.valuationOutputInventoryId,
      evidence,
    ])
  );
  if (
    evidenceByInventory.size !== input.custodyReceipts.length ||
    evidenceByInventory.size !== indexContent.entries.length
  ) {
    return fail('custody receipt set does not exactly cover the inventory index');
  }
  const inventoryById = new Map(
    input.inventoryIndexVerification.valuationOutputInventories.map(
      ({ valuationOutputInventory }) => [
        valuationOutputInventory.valuationOutputInventoryId,
        valuationOutputInventory,
      ]
    )
  );
  const entries = indexContent.entries.map((indexEntry) => {
    const evidence = evidenceByInventory.get(indexEntry.valuationOutputInventoryId);
    const inventory = inventoryById.get(indexEntry.valuationOutputInventoryId);
    if (!evidence || !inventory) return fail('missing exact custody or inventory evidence');
    const { receipt, receiptArtifactRef, receiptReadback, receiptReadbackArtifactRef } = evidence;
    const inventoryBinding = receipt.content.artifacts.find(
      ({ role }) => role === 'valuation_output_inventory'
    );
    if (
      receipt.content.environment !== bundle.content.environment ||
      receipt.content.valuationBundleId !== bundle.valuationBundleId ||
      receipt.content.tradeId !== indexEntry.tradeId ||
      receipt.content.valuationCaseId !== indexEntry.valuationCaseId ||
      receipt.content.valueUnitId !== indexContent.valueUnitId ||
      receipt.content.operation.content.outputSetSha256 !== inventory.content.outputSetSha256 ||
      !inventoryBinding ||
      inventoryBinding.semanticId !== indexEntry.valuationOutputInventoryId ||
      !exact(inventoryBinding.artifact, indexEntry.inventoryArtifactRef) ||
      !doesAflTradeArtifactRefMatchCanonicalJson(receiptArtifactRef, receipt) ||
      !exact(receiptReadback.content.artifact, receiptArtifactRef) ||
      receiptReadback.content.status !== 'passed' ||
      receiptReadback.content.custodyEnvironment !== bundle.content.environment ||
      receiptReadback.content.artifactClass !== 'derived_private' ||
      !doesAflTradeArtifactRefMatchCanonicalJson(receiptReadbackArtifactRef, receiptReadback)
    ) {
      return fail('custody receipt does not authenticate its exact indexed output');
    }
    return {
      tradeId: indexEntry.tradeId,
      valuationCaseId: indexEntry.valuationCaseId,
      valuationOutputInventoryId: indexEntry.valuationOutputInventoryId,
      inventoryArtifactRef: indexEntry.inventoryArtifactRef,
      operationId: receipt.content.operationId,
      receiptId: receipt.receiptId,
      receiptArtifactRef,
      receiptReadbackArtifactRef,
      verifiedAt: receipt.content.verifiedAt,
    };
  });
  const content = aflTradeValuationOutputCustodyIndexContentSchema.parse({
    schemaVersion: AFL_TRADE_VALUATION_OUTPUT_CUSTODY_INDEX_SCHEMA_VERSION,
    environment: bundle.content.environment,
    valuationBundleId: bundle.valuationBundleId,
    valuationOutputInventoryIndex: {
      valuationOutputInventoryIndexId:
        index.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      artifactRef: index.valuationOutputInventoryIndexArtifactRef,
      inventorySetSha256: indexContent.inventorySetSha256,
    },
    scopeKey: indexContent.scopeKey,
    valueUnitId: indexContent.valueUnitId,
    ordering: 'trade_id_code_unit_ascending',
    entryCount: entries.length,
    custodyReceiptSetSha256: sha256AflTradeCanonicalJson(entries),
    entries,
    createdAt: input.createdAt,
    verification: 'exact_inventory_index_to_completed_custody_set',
    publicationEligible: false,
  });
  const valuationOutputCustodyIndex = aflTradeValuationOutputCustodyIndexSchema.parse({
    valuationOutputCustodyIndexId: createAflTradeContentAddress(
      'valuation-output-custody-index',
      content
    ),
    content,
  });
  return deepFreeze(
    aflTradeValuationOutputCustodyIndexResultSchema.parse({
      valuationOutputCustodyIndex,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(
        valuationOutputCustodyIndex,
        input.createdAt
      ),
    })
  );
}

export function verifyAflTradeValuationOutputCustodyIndex(input: unknown): boolean {
  try {
    const parsed = z
      .object({
        inventoryIndexVerification: aflTradeValuationOutputInventoryIndexVerifyInputSchema,
        custodyReceipts: z.array(custodyEvidenceSchema).min(1).max(10_000),
        createdAt: z.iso.datetime({ offset: true }),
        output: aflTradeValuationOutputCustodyIndexResultSchema,
      })
      .strict()
      .parse(snapshot(input));
    const replay = createAflTradeValuationOutputCustodyIndex({
      inventoryIndexVerification: parsed.inventoryIndexVerification,
      custodyReceipts: parsed.custodyReceipts,
      createdAt: parsed.createdAt,
    });
    return exact(replay, parsed.output);
  } catch {
    return false;
  }
}

export function createAflTradeCustodiedPublicationManifest(
  unparsedInput: unknown
): AflTradeCustodiedPublicationManifestResult {
  let input: z.infer<typeof custodiedPublicationInputSchema>;
  try {
    input = custodiedPublicationInputSchema.parse(snapshot(unparsedInput));
  } catch {
    return fail('invalid custodied-publication input envelope');
  }
  if (!verifyAflTradeValuationOutputCustodyIndex(input.custodyIndexVerification)) {
    return fail('custody index does not replay exactly');
  }
  const candidate = input.publicationCandidate;
  const custodyResult = input.custodyIndexVerification.output;
  const custody = custodyResult.valuationOutputCustodyIndex.content;
  const inventory = candidate.content.valuationOutputInventoryIndex;
  if (
    custody.environment !== candidate.content.environment ||
    custody.valuationBundleId !== candidate.content.valuationBundleId ||
    custody.valuationOutputInventoryIndex.valuationOutputInventoryIndexId !==
      inventory.valuationOutputInventoryIndexId ||
    custody.valuationOutputInventoryIndex.inventorySetSha256 !== inventory.inventorySetSha256 ||
    custody.valuationOutputInventoryIndex.artifactRef.artifactId !==
      inventory.artifactRef.artifactId ||
    custody.scopeKey !== candidate.content.scopeKey ||
    custody.valueUnitId !== candidate.content.valueUnitId ||
    custody.entryCount !== candidate.content.entryCount
  ) {
    return fail('publication candidate does not match the exact completed custody set');
  }
  const content = {
    ...candidate.content,
    schemaVersion: 'afl-trade-publication/v4' as const,
    valuationOutputCustodyIndex: {
      schemaVersion: custody.schemaVersion,
      valuationOutputCustodyIndexId:
        custodyResult.valuationOutputCustodyIndex.valuationOutputCustodyIndexId,
      artifactRef: custodyResult.artifactRef,
      environment: custody.environment,
      valuationBundleId: custody.valuationBundleId,
      valuationOutputInventoryIndexId:
        custody.valuationOutputInventoryIndex.valuationOutputInventoryIndexId,
      inventorySetSha256: custody.valuationOutputInventoryIndex.inventorySetSha256,
      scopeKey: custody.scopeKey,
      valueUnitId: custody.valueUnitId,
      entryCount: custody.entryCount,
      custodyReceiptSetSha256: custody.custodyReceiptSetSha256,
    },
  };
  const publicationManifest = aflTradePublicationManifestV4Schema.parse({
    publicationId: createAflTradeContentAddress('publication', content),
    content,
  });
  return deepFreeze(
    aflTradeCustodiedPublicationManifestResultSchema.parse({
      publicationManifest,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(
        publicationManifest,
        publicationManifest.content.createdAt
      ),
    })
  );
}

export function verifyAflTradeCustodiedPublicationManifest(input: unknown): boolean {
  try {
    const parsed = custodiedPublicationInputSchema
      .extend({ output: aflTradeCustodiedPublicationManifestResultSchema })
      .strict()
      .parse(snapshot(input));
    const replay = createAflTradeCustodiedPublicationManifest({
      publicationCandidate: parsed.publicationCandidate,
      custodyIndexVerification: parsed.custodyIndexVerification,
    });
    return exact(replay, parsed.output);
  } catch {
    return false;
  }
}
