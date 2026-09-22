import { z } from 'zod';

export const LOCAL_PRIVATE_VALUATION_CONSTRUCTION_REPORT_SCHEMA_VERSION =
  'afl-private-valuation-construction-report/v1';

/**
 * Where a blocker sits. `source_role` and `declaration` name reviewed authority the scope must
 * supply; `owner` names a composition owner that does not exist yet; `asset` names one asset and view
 * of the declared valuation case; `scope` names the scope itself.
 */
const subjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scope'), id: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('source_role'), id: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('declaration'), id: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('owner'), id: z.string().min(1).max(200) }).strict(),
  z
    .object({
      kind: z.literal('asset'),
      id: z.string().min(1).max(200),
      view: z.string().min(1).max(100),
    })
    .strict(),
]);

export const localPrivateValuationConstructionBlockerSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{2,80}$/u),
    subject: subjectSchema,
    reason: z.string().min(1).max(500),
  })
  .strict();

export const localPrivateValuationConstructionReportSchema = z
  .object({
    schemaVersion: z.literal(LOCAL_PRIVATE_VALUATION_CONSTRUCTION_REPORT_SCHEMA_VERSION),
    scopeKey: z.string().min(1).max(200),
    state: z.enum(['composable', 'blocked']),
    /** Composing construction never grants model, source or publication authority. */
    qualificationGranted: z.literal(false),
    /** Distinct blocker codes, so a caller can gate on the vocabulary without reading every reason. */
    blockerCodes: z.array(z.string()),
    blockers: z.array(localPrivateValuationConstructionBlockerSchema),
  })
  .strict();

export type LocalPrivateValuationConstructionBlockerSubject = z.infer<typeof subjectSchema>;
export type LocalPrivateValuationConstructionBlocker = z.infer<
  typeof localPrivateValuationConstructionBlockerSchema
>;
export type LocalPrivateValuationConstructionReport = z.infer<
  typeof localPrivateValuationConstructionReportSchema
>;

/**
 * Reasons are recorded, printed and pasted into receipts, so no connection string or credential may
 * survive into one. Upstream owners already fail closed with a prose reason; keep it, minus secrets.
 */
export function safeLocalPrivateValuationConstructionReason(error: unknown): string {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : 'The construction authority is unavailable.';
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/giu, '[redacted-database-url]')
    .replace(/\b[a-f0-9]{64}\b/gu, '[redacted-secret]')
    .slice(0, 500);
}

export function createLocalPrivateValuationConstructionBlocker(input: {
  readonly code: string;
  readonly subject: LocalPrivateValuationConstructionBlockerSubject;
  readonly reason: string;
}): LocalPrivateValuationConstructionBlocker {
  return localPrivateValuationConstructionBlockerSchema.parse(input);
}

/** Deterministic order and codes: the same scope always reports the same verdict. */
export function createLocalPrivateValuationConstructionReport(input: {
  readonly scopeKey: string;
  readonly blockers: readonly LocalPrivateValuationConstructionBlocker[];
}): LocalPrivateValuationConstructionReport {
  const blockers = [...input.blockers].sort((left, right) => {
    const leftKey = `${left.code}\0${left.subject.kind}\0${left.subject.id}\0${left.reason}`;
    const rightKey = `${right.code}\0${right.subject.kind}\0${right.subject.id}\0${right.reason}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return localPrivateValuationConstructionReportSchema.parse({
    schemaVersion: LOCAL_PRIVATE_VALUATION_CONSTRUCTION_REPORT_SCHEMA_VERSION,
    scopeKey: input.scopeKey,
    state: blockers.length === 0 ? 'composable' : 'blocked',
    qualificationGranted: false,
    blockerCodes: [...new Set(blockers.map((blocker) => blocker.code))].sort((left, right) =>
      left.localeCompare(right)
    ),
    blockers,
  });
}
