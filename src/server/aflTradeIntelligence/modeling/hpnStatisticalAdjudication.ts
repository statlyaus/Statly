import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchBytes,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { listAflTradeHpnRequiredSemanticFields } from './hpnCalculationEligibility';

const id = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const timestamp = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const candidatePrefix = 'hpn-statistical-cell';
const decisionPrefix = 'hpn-statistical-decision';
const statistic = z
  .string()
  .refine(
    (value) =>
      listAflTradeHpnRequiredSemanticFields('player_match_stats').some(
        (field) => field === value && !['player', 'match', 'club'].includes(field)
      ),
    'Expected an HPN player statistic.'
  );
const scopeSchema = z
  .object({
    environment: z.literal('non_production'),
    competitionId: id,
    season: z.number().int().min(1897).max(9999),
    playerId: id,
    matchId: id,
    clubId: id,
    statistic,
  })
  .strict();
const observationSchema = z
  .object({
    normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
    stagingSha256: aflTradeSha256Schema,
    provider: id,
    capabilityId: id,
    captureId: id,
    sourceSnapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
    sourceArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    providerDecodedRowId: id,
    sourceRowSha256: aflTradeSha256Schema,
    typedPayloadSha256: aflTradeSha256Schema,
    fieldMapId: aflTradeContentAddressedIdSchema('hpn-pav-field-map'),
    fieldMapSha256: aflTradeSha256Schema,
    sourceFields: z.array(z.string().min(1).max(200)).min(1).max(10),
    value: count,
    representation: z.enum(['measured', 'blank_normalized_zero']),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.fieldMapId !== `hpn-pav-field-map:${value.fieldMapSha256}`) {
      ctx.addIssue({
        code: 'custom',
        message: 'Field-map identifier must match its content digest.',
      });
    }
    if (new Set(value.sourceFields).size !== value.sourceFields.length) {
      ctx.addIssue({ code: 'custom', message: 'Source fields must be unique.' });
    }
    if (value.representation === 'blank_normalized_zero' && value.value !== 0) {
      ctx.addIssue({ code: 'custom', message: 'A normalized blank can only represent zero.' });
    }
  });
const candidateBody = z
  .object({
    schemaVersion: z.literal('afl-trade-hpn-statistical-cell/v1'),
    scope: scopeSchema,
    primary: observationSchema,
    corroborating: observationSchema,
    createdAt: timestamp,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.primary.value === value.corroborating.value) {
      ctx.addIssue({
        code: 'custom',
        message: 'A discrepancy requires different retained values.',
      });
    }
    const { primary, corroborating } = value;
    // Distinct labels alone cannot prove independence; retained lineage must be checked again by the repository.
    if (
      primary.normalizationRunId === corroborating.normalizationRunId ||
      primary.provider === corroborating.provider ||
      primary.captureId === corroborating.captureId ||
      primary.sourceSnapshotId === corroborating.sourceSnapshotId ||
      primary.sourceArtifactId === corroborating.sourceArtifactId ||
      primary.providerDecodedRowId === corroborating.providerDecodedRowId ||
      ((primary.sourceRowSha256 === corroborating.sourceRowSha256 ||
        primary.typedPayloadSha256 === corroborating.typedPayloadSha256) &&
        primary.fieldMapSha256 === corroborating.fieldMapSha256)
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Observations must bind distinct providers and retained run/capture/row provenance.',
      });
    }
  });
export const aflTradeHpnStatisticalCellSchema = candidateBody
  .safeExtend({
    candidateId: aflTradeContentAddressedIdSchema(candidatePrefix),
  })
  .superRefine(({ candidateId, ...body }, ctx) => {
    addAflTradeContentAddressIssue(candidatePrefix, candidateId, body, ctx, ['candidateId']);
  });
export type AflTradeHpnStatisticalCell = z.infer<typeof aflTradeHpnStatisticalCellSchema>;

export function createAflTradeHpnStatisticalCell(input: z.input<typeof candidateBody>) {
  const body = candidateBody.parse(input);
  return aflTradeHpnStatisticalCellSchema.parse({
    ...body,
    candidateId: createAflTradeContentAddress(candidatePrefix, body),
  });
}

const decisionFields = z
  .object({
    schemaVersion: z.literal('afl-trade-hpn-statistical-decision/v1'),
    candidate: aflTradeHpnStatisticalCellSchema,
    selectedSource: z.enum(['primary', 'corroborating']),
    selectedValue: count,
    evidence: z
      .array(
        z
          .object({
            artifact: aflTradeArtifactRefSchema,
            locator: z.string().min(1).max(1000),
            observedValue: count,
            representation: z.literal('measured'),
          })
          .strict()
      )
      .min(1)
      .max(50),
    reviewerId: id,
    rationale: z.string().trim().min(1).max(2000),
    decidedAt: timestamp,
    supersedesDecisionId: aflTradeContentAddressedIdSchema(decisionPrefix).nullable(),
    authority: z.literal('requires_repository_verification'),
    publicationEligible: z.literal(false),
  })
  .strict();
const decisionBody = decisionFields.superRefine((value, ctx) => {
  if (value.selectedValue !== value.candidate[value.selectedSource].value) {
    ctx.addIssue({
      code: 'custom',
      message: 'Decision must select the unchanged retained source value.',
    });
  }
  if (Date.parse(value.decidedAt) < Date.parse(value.candidate.createdAt)) {
    ctx.addIssue({ code: 'custom', message: 'Decision predates its candidate.' });
  }
  let previousKey: string | null = null;
  for (const evidence of value.evidence) {
    const key = JSON.stringify([evidence.artifact.artifactId, evidence.locator]);
    if (
      (previousKey !== null && key <= previousKey) ||
      evidence.observedValue !== value.selectedValue ||
      Date.parse(evidence.artifact.createdAt) > Date.parse(value.decidedAt)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Evidence must be uniquely ordered, timely and support the selected value.',
      });
    }
    previousKey = key;
  }
});
export const aflTradeHpnStatisticalDecisionSchema = decisionBody
  .safeExtend({
    decisionId: aflTradeContentAddressedIdSchema(decisionPrefix),
  })
  .superRefine(({ decisionId, ...body }, ctx) => {
    addAflTradeContentAddressIssue(decisionPrefix, decisionId, body, ctx, ['decisionId']);
  });
export type AflTradeHpnStatisticalDecision = z.infer<typeof aflTradeHpnStatisticalDecisionSchema>;

/** Byte integrity does not establish source rights, identity, authorship or current authority. */
export function createAflTradeHpnStatisticalDecision(
  input: z.input<typeof decisionBody>,
  evidenceBytes: ReadonlyMap<string, Uint8Array>
) {
  const body = decisionFields.parse(input);
  for (const { artifact } of body.evidence) {
    const bytes = evidenceBytes.get(artifact.artifactId);
    if (!bytes || !doesAflTradeArtifactRefMatchBytes(artifact, bytes)) {
      throw new Error('Missing or altered evidence bytes.');
    }
  }
  body.evidence.sort((a, b) => {
    const left = JSON.stringify([a.artifact.artifactId, a.locator]);
    const right = JSON.stringify([b.artifact.artifactId, b.locator]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return aflTradeHpnStatisticalDecisionSchema.parse({
    ...body,
    decisionId: createAflTradeContentAddress(decisionPrefix, body),
  });
}

/** Checks exact supplied membership only. Repository must authenticate the universe and current heads. */
export function assessAflTradeHpnStatisticalCoverage(
  cells: readonly AflTradeHpnStatisticalCell[],
  decisions: readonly AflTradeHpnStatisticalDecision[]
) {
  if (!cells.length) throw new Error('A discrepancy universe is required.');
  const candidates = cells.map((cell) => aflTradeHpnStatisticalCellSchema.parse(cell));
  const expected = new Set(candidates.map((cell) => cell.candidateId));
  const scopes = new Set(candidates.map((cell) => JSON.stringify(cell.scope)));
  if (expected.size !== cells.length || scopes.size !== cells.length) {
    throw new Error('Duplicate discrepancy cell.');
  }
  const first = candidates[0].scope;
  if (
    candidates.some(
      ({ scope }) => scope.competitionId !== first.competitionId || scope.season !== first.season
    )
  ) {
    throw new Error('Cross-competition or cross-season discrepancy universe.');
  }
  const supplied = new Set<string>();
  const parsed = decisions.map((decision) => aflTradeHpnStatisticalDecisionSchema.parse(decision));
  const ids = new Set(parsed.map((decision) => decision.decisionId));
  for (const decision of parsed) {
    const key = decision.candidate.candidateId;
    if (
      !expected.has(key) ||
      supplied.has(key) ||
      (decision.supersedesDecisionId !== null && ids.has(decision.supersedesDecisionId))
    ) {
      throw new Error('Extra, conflicting or superseded decision.');
    }
    supplied.add(key);
  }
  const missingCandidateIds = [...expected].filter((key) => !supplied.has(key)).sort();
  const membership = parsed
    .map(({ candidate, decisionId }) => ({
      candidateId: candidate.candidateId,
      decisionId,
    }))
    .sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));
  return {
    status: missingCandidateIds.length ? ('incomplete' as const) : ('coverage_complete' as const),
    missingCandidateIds,
    membership,
    coverageId: createAflTradeContentAddress('hpn-statistical-coverage', {
      candidateIds: [...expected].sort(),
      membership,
    }),
    authority: 'requires_repository_verification' as const,
    calculationEligible: false as const,
  };
}
