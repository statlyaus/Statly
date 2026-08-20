import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  createAflTradeByteArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { createAflTradeCalculationNarrative } from './tradeCalculationNarrative';

type CalculationNarrative = ReturnType<typeof createAflTradeCalculationNarrative>;
type ReaderDocumentKind = 'archive_summary' | 'detail' | 'reader_api' | 'json_export';
type RetainedArtifactKind =
  | 'calculation_narrative'
  | ReaderDocumentKind
  | 'projection_manifest'
  | 'generation';

export interface GovernedPrivateEvaluationSelector {
  readonly valuationScopeKey: string;
  readonly tradeId: string;
}

export interface GovernedPrivateEvaluationRetainedArtifact {
  readonly kind: RetainedArtifactKind;
  readonly reference: AflTradeArtifactRef;
  readonly bytes: Uint8Array;
}

interface ProjectionManifest {
  readonly projectionManifestId: string;
  readonly content: {
    readonly schemaVersion: 'governed-private-evaluation-projection-manifest/v1';
    readonly selector: GovernedPrivateEvaluationSelector;
    readonly narrativeId: string;
    readonly generatedAt: string;
    readonly documents: readonly Readonly<{
      kind: ReaderDocumentKind;
      artifact: AflTradeArtifactRef;
    }>[];
    readonly runtimeHtmlRetention: 'prohibited';
  };
}

interface EvaluationGeneration {
  readonly generationId: string;
  readonly content: {
    readonly schemaVersion: 'local-private-trade-evaluation-generation/v1';
    readonly environment: 'test_fixture';
    readonly selector: GovernedPrivateEvaluationSelector;
    readonly transitionIntentId: string;
    readonly narrativeId: string;
    readonly narrativeArtifact: AflTradeArtifactRef;
    readonly projectionManifestId: string;
    readonly projectionManifestArtifact: AflTradeArtifactRef;
    readonly generatedAt: string;
    readonly activationReceipt: 'separate_append_only_transition';
    readonly publicationProhibited: true;
  };
}

export interface GovernedPrivateEvaluationDetailDocument {
  readonly schemaVersion: 'governed-private-evaluation-detail/v1';
  readonly selector: GovernedPrivateEvaluationSelector;
  readonly narrativeId: string;
  readonly narrative: CalculationNarrative['content'];
}

export interface GovernedPrivateEvaluationGenerationMaterialization {
  readonly projectionManifest: ProjectionManifest;
  readonly generation: EvaluationGeneration;
  readonly artifacts: GovernedPrivateEvaluationRetainedArtifact[];
}

const retainedSelectorSchema = z
  .object({
    valuationScopeKey: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,399}$/u),
    tradeId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,399}$/u),
  })
  .strict();
const readerDocumentKindSchema = z.enum([
  'archive_summary',
  'detail',
  'reader_api',
  'json_export',
]);
const retainedGenerationV1Schema = z
  .object({
    generationId: aflTradeContentAddressedIdSchema('local-private-trade-evaluation-generation'),
    content: z
      .object({
        schemaVersion: z.literal('local-private-trade-evaluation-generation/v1'),
        environment: z.literal('test_fixture'),
        selector: retainedSelectorSchema,
        transitionIntentId: aflTradeContentAddressedIdSchema(
          'private-evaluation-transition-intent'
        ),
        narrativeId: aflTradeContentAddressedIdSchema('trade-calculation-narrative'),
        narrativeArtifact: aflTradeArtifactRefSchema,
        projectionManifestId: aflTradeContentAddressedIdSchema(
          'private-evaluation-projection-manifest'
        ),
        projectionManifestArtifact: aflTradeArtifactRefSchema,
        generatedAt: z.iso.datetime({ offset: true }),
        activationReceipt: z.literal('separate_append_only_transition'),
        publicationProhibited: z.literal(true),
      })
      .strict(),
  })
  .strict();
const retainedProjectionManifestV1Schema = z
  .object({
    projectionManifestId: aflTradeContentAddressedIdSchema(
      'private-evaluation-projection-manifest'
    ),
    content: z
      .object({
        schemaVersion: z.literal('governed-private-evaluation-projection-manifest/v1'),
        selector: retainedSelectorSchema,
        narrativeId: aflTradeContentAddressedIdSchema('trade-calculation-narrative'),
        generatedAt: z.iso.datetime({ offset: true }),
        documents: z
          .array(
            z
              .object({
                kind: readerDocumentKindSchema,
                artifact: aflTradeArtifactRefSchema,
              })
              .strict()
          )
          .length(4),
        runtimeHtmlRetention: z.literal('prohibited'),
      })
      .strict(),
  })
  .strict();

export class UnsupportedGovernedPrivateEvaluationProjectionVersionError extends Error {}

function retainedSchemaVersion(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const content = (value as { readonly content?: unknown }).content;
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return null;
  const schemaVersion = (content as { readonly schemaVersion?: unknown }).schemaVersion;
  return typeof schemaVersion === 'string' ? schemaVersion : null;
}

export function parseGovernedPrivateEvaluationGeneration(
  value: unknown
): EvaluationGeneration {
  const version = retainedSchemaVersion(value);
  if (
    version !== null &&
    version !== 'local-private-trade-evaluation-generation/v1'
  ) {
    throw new UnsupportedGovernedPrivateEvaluationProjectionVersionError(
      `Unsupported private evaluation generation version: ${version}`
    );
  }
  return retainedGenerationV1Schema.parse(value) as EvaluationGeneration;
}

export function parseGovernedPrivateEvaluationProjectionManifest(
  value: unknown
): ProjectionManifest {
  const version = retainedSchemaVersion(value);
  if (
    version !== null &&
    version !== 'governed-private-evaluation-projection-manifest/v1'
  ) {
    throw new UnsupportedGovernedPrivateEvaluationProjectionVersionError(
      `Unsupported private evaluation projection manifest version: ${version}`
    );
  }
  return retainedProjectionManifestV1Schema.parse(value) as ProjectionManifest;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const artifactOrder: readonly RetainedArtifactKind[] = [
  'calculation_narrative',
  'archive_summary',
  'detail',
  'reader_api',
  'json_export',
  'projection_manifest',
  'generation',
];

function canonicalBytes(value: unknown, terminalNewline = false): Uint8Array {
  return encoder.encode(`${canonicalizeAflTradeJson(value)}${terminalNewline ? '\n' : ''}`);
}

function retained(
  kind: RetainedArtifactKind,
  bytes: Uint8Array,
  generatedAt: string
): GovernedPrivateEvaluationRetainedArtifact {
  return {
    kind,
    bytes: Uint8Array.from(bytes),
    reference: createAflTradeByteArtifactRef(bytes, 'application/json', generatedAt),
  };
}

function same(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

function validSelector(selector: GovernedPrivateEvaluationSelector): boolean {
  return (
    /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,399}$/u.test(selector.valuationScopeKey) &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,399}$/u.test(selector.tradeId)
  );
}

function parseArtifactJson(
  artifact: GovernedPrivateEvaluationRetainedArtifact,
  terminalNewline = false
): unknown {
  const text = decoder.decode(artifact.bytes);
  if (terminalNewline !== text.endsWith('\n')) {
    throw new TypeError('Retained JSON byte framing does not match its document kind.');
  }
  return JSON.parse(text);
}

export function decodeGovernedPrivateEvaluationDetailDocument(
  bytes: Uint8Array
): GovernedPrivateEvaluationDetailDocument {
  try {
    const text = decoder.decode(bytes);
    if (text.endsWith('\n')) {
      throw new TypeError('Detail JSON must use canonical framing without a terminal newline.');
    }
    const value = JSON.parse(text) as Partial<GovernedPrivateEvaluationDetailDocument>;
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      canonicalizeAflTradeJson(Object.keys(value).sort()) !==
        canonicalizeAflTradeJson(['narrative', 'narrativeId', 'schemaVersion', 'selector']) ||
      value.schemaVersion !== 'governed-private-evaluation-detail/v1' ||
      value.selector === undefined ||
      !validSelector(value.selector) ||
      typeof value.narrativeId !== 'string' ||
      value.narrative === undefined ||
      value.narrative.tradeId !== value.selector.tradeId ||
      value.narrative.publicationProhibited !== true ||
      canonicalizeAflTradeJson(value.narrative.views.map(({ view }) => view)) !==
        canonicalizeAflTradeJson(['at_trade', 'realized', 'remaining', 'current']) ||
      createAflTradeContentAddress('trade-calculation-narrative', value.narrative) !==
        value.narrativeId
    ) {
      throw new TypeError('Private evaluation detail document failed narrative authentication.');
    }
    return structuredClone(value) as GovernedPrivateEvaluationDetailDocument;
  } catch (error) {
    if (error instanceof TypeError && /detail|narrative/u.test(error.message)) throw error;
    throw new TypeError('Private evaluation detail document is malformed or unauthenticated.');
  }
}

export function createGovernedPrivateEvaluationGeneration(input: {
  readonly selector: GovernedPrivateEvaluationSelector;
  readonly transitionIntentId: string;
  readonly generatedAt: string;
  readonly narrative: CalculationNarrative;
}): GovernedPrivateEvaluationGenerationMaterialization {
  if (
    !validSelector(input.selector) ||
    input.selector.tradeId !== input.narrative.content.tradeId ||
    !/^private-evaluation-transition-intent:[a-f0-9]{64}$/u.test(input.transitionIntentId) ||
    createAflTradeContentAddress('trade-calculation-narrative', input.narrative.content) !==
      input.narrative.narrativeId ||
    input.narrative.content.publicationProhibited !== true
  ) {
    throw new TypeError('Private evaluation generation requires one authentic test-fixture narrative.');
  }

  const current = input.narrative.content.views.find(({ view }) => view === 'current');
  if (current === undefined) {
    throw new TypeError('Private evaluation generation requires the synchronized current view.');
  }
  const archiveSummary = {
    schemaVersion: 'governed-private-evaluation-archive-summary/v1' as const,
    selector: { ...input.selector },
    narrativeId: input.narrative.narrativeId,
    valueUnitId: input.narrative.content.valueUnitId,
    defaultView: input.narrative.content.defaultView,
    clubs: current.clubs.map((club) => ({
      aflClubId: club.aflClubId,
      clubName: club.clubName,
      receivedAssetIds: [...club.receivedAssetIds],
      givenUpAssetIds: [...club.givenUpAssetIds],
      estimatedAdvantageMean: club.arithmetic.estimatedAdvantageMean,
      grade: { ...club.grade },
    })),
  };
  const detail = {
    schemaVersion: 'governed-private-evaluation-detail/v1' as const,
    selector: { ...input.selector },
    narrativeId: input.narrative.narrativeId,
    narrative: input.narrative.content,
  };
  const readerApi = {
    schemaVersion: 'governed-private-evaluation-reader-api/v1' as const,
    selector: { ...input.selector },
    narrativeId: input.narrative.narrativeId,
    archiveSummary,
    detail,
  };
  const artifacts = [
    retained('calculation_narrative', canonicalBytes(input.narrative), input.generatedAt),
    retained('archive_summary', canonicalBytes(archiveSummary), input.generatedAt),
    retained('detail', canonicalBytes(detail), input.generatedAt),
    retained('reader_api', canonicalBytes(readerApi), input.generatedAt),
    retained('json_export', canonicalBytes(readerApi, true), input.generatedAt),
  ];
  const projectionManifestContent: ProjectionManifest['content'] = {
    schemaVersion: 'governed-private-evaluation-projection-manifest/v1',
    selector: { ...input.selector },
    narrativeId: input.narrative.narrativeId,
    generatedAt: input.generatedAt,
    documents: artifacts.slice(1).map(({ kind, reference }) => ({
      kind: kind as ReaderDocumentKind,
      artifact: reference,
    })),
    runtimeHtmlRetention: 'prohibited',
  };
  const projectionManifest: ProjectionManifest = {
    projectionManifestId: createAflTradeContentAddress(
      'private-evaluation-projection-manifest',
      projectionManifestContent
    ),
    content: projectionManifestContent,
  };
  const manifestArtifact = retained(
    'projection_manifest',
    canonicalBytes(projectionManifest),
    input.generatedAt
  );
  artifacts.push(manifestArtifact);
  const generationContent: EvaluationGeneration['content'] = {
    schemaVersion: 'local-private-trade-evaluation-generation/v1',
    environment: 'test_fixture',
    selector: { ...input.selector },
    transitionIntentId: input.transitionIntentId,
    narrativeId: input.narrative.narrativeId,
    narrativeArtifact: artifacts[0]!.reference,
    projectionManifestId: projectionManifest.projectionManifestId,
    projectionManifestArtifact: manifestArtifact.reference,
    generatedAt: input.generatedAt,
    activationReceipt: 'separate_append_only_transition',
    publicationProhibited: true,
  };
  const generation: EvaluationGeneration = {
    generationId: createAflTradeContentAddress(
      'local-private-trade-evaluation-generation',
      generationContent
    ),
    content: generationContent,
  };
  artifacts.push(retained('generation', canonicalBytes(generation), input.generatedAt));
  return { projectionManifest, generation, artifacts };
}

export function verifyGovernedPrivateEvaluationGeneration(
  materialization: GovernedPrivateEvaluationGenerationMaterialization
): boolean {
  try {
    const retainedGeneration = parseGovernedPrivateEvaluationGeneration(
      materialization.generation
    );
    const retainedProjectionManifest = parseGovernedPrivateEvaluationProjectionManifest(
      materialization.projectionManifest
    );
    if (
      materialization.artifacts.length !== artifactOrder.length ||
      materialization.artifacts.some(
        (artifact, index) =>
          artifact.kind !== artifactOrder[index] ||
          !doesAflTradeArtifactRefMatchBytes(
            artifact.reference,
            artifact.bytes,
            'application/json'
          )
      )
    ) {
      return false;
    }
    const byKind = new Map(materialization.artifacts.map((artifact) => [artifact.kind, artifact]));
    const narrative = parseArtifactJson(byKind.get('calculation_narrative')!);
    const archiveSummary = parseArtifactJson(byKind.get('archive_summary')!);
    const detail = parseArtifactJson(byKind.get('detail')!);
    const readerApi = parseArtifactJson(byKind.get('reader_api')!);
    const jsonExport = parseArtifactJson(byKind.get('json_export')!, true);
    const manifest = parseGovernedPrivateEvaluationProjectionManifest(
      parseArtifactJson(byKind.get('projection_manifest')!)
    );
    const generation = parseGovernedPrivateEvaluationGeneration(
      parseArtifactJson(byKind.get('generation')!)
    );
    const expectedDocuments = (['archive_summary', 'detail', 'reader_api', 'json_export'] as const).map(
      (kind) => ({ kind, artifact: byKind.get(kind)!.reference })
    );
    const narrativeEnvelope = narrative as CalculationNarrative;
    return (
      createAflTradeContentAddress('trade-calculation-narrative', narrativeEnvelope.content) ===
        narrativeEnvelope.narrativeId &&
      same((detail as { narrative: unknown }).narrative, narrativeEnvelope.content) &&
      same((readerApi as { archiveSummary: unknown }).archiveSummary, archiveSummary) &&
      same((readerApi as { detail: unknown }).detail, detail) &&
      same(readerApi, jsonExport) &&
      same(manifest, retainedProjectionManifest) &&
      same(generation, retainedGeneration) &&
      same(retainedProjectionManifest.content.documents, expectedDocuments) &&
      createAflTradeContentAddress(
        'private-evaluation-projection-manifest',
        retainedProjectionManifest.content
      ) === retainedProjectionManifest.projectionManifestId &&
      createAflTradeContentAddress(
        'local-private-trade-evaluation-generation',
        retainedGeneration.content
      ) === retainedGeneration.generationId &&
      same(
        retainedGeneration.content.narrativeArtifact,
        byKind.get('calculation_narrative')!.reference
      ) &&
      same(
        retainedGeneration.content.projectionManifestArtifact,
        byKind.get('projection_manifest')!.reference
      ) &&
      retainedGeneration.content.projectionManifestId ===
        retainedProjectionManifest.projectionManifestId
    );
  } catch {
    return false;
  }
}
