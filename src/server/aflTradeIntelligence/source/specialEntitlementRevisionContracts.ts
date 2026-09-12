import { z } from 'zod';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  aflTradeContentAddressedIdSchema,
} from '../artifacts/contentAddress';
import { specialEntitlementAwardSchema } from './specialEntitlementAwardContracts';
import { specialEntitlementLifecycleSchema } from './specialEntitlementLifecycleContracts';

const id = z.string().trim().min(1);
const revisionId = aflTradeContentAddressedIdSchema('special-entitlement-revision');
const reviewedLifecycle = z
  .object({ record: specialEntitlementLifecycleSchema, approvalDecisionId: id })
  .strict();
const custodyEdge = z
  .object({
    transferId: aflTradeContentAddressedIdSchema('external-transfer'),
    assetVersionId: id,
    eventVersionId: id,
    predecessorTransferId: aflTradeContentAddressedIdSchema('external-transfer').nullable(),
    fromClubId: id,
    toClubId: id,
    seasonYear: z.number().int().min(1988).max(2200),
    occurredOn: z.iso.date().nullable(),
  })
  .strict();

/** Complete replacement state, not a patch that can leave dependent facts on an old revision.
 * Canonical references and approvals must still be authenticated by the database owner.
 */
export const specialEntitlementRevisionStateSchema = z
  .object({
    award: z.object({ award: specialEntitlementAwardSchema, approvalDecisionId: id }).strict(),
    custody: z.array(custodyEdge),
    activation: reviewedLifecycle.nullable(),
    exercise: reviewedLifecycle.nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    const { award } = state.award;
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (
      state.activation &&
      (state.activation.record.kind !== 'activation' ||
        state.activation.record.entitlementId !== award.entitlementId ||
        award.content.asset.entitlementType !== 'expansion_compensation')
    )
      issue('Activation must belong to this compensation right.');
    if (
      state.exercise &&
      (state.exercise.record.kind !== 'exercise' ||
        state.exercise.record.entitlementId !== award.entitlementId)
    )
      issue('Exercise must belong to this right.');
    if (
      state.exercise &&
      award.content.asset.entitlementType === 'expansion_compensation' &&
      !state.activation
    )
      issue('Compensation exercise requires activation in the same revision.');
    let holder = award.content.holderClubId;
    let predecessor: string | null = null;
    let earliest = award.content.awardedOn ?? `${award.content.awardYear}-01-01`;
    const transfers = new Set<string>();
    const assets = new Set<string>();
    for (const edge of state.custody) {
      if (transfers.has(edge.transferId) || assets.has(edge.assetVersionId))
        issue('Custody references must not repeat.');
      transfers.add(edge.transferId);
      assets.add(edge.assetVersionId);
      if (
        edge.predecessorTransferId !== predecessor ||
        edge.fromClubId !== holder ||
        edge.fromClubId === edge.toClubId
      )
        issue('Revision custody must form one continuous ordered holder chain.');
      if (edge.occurredOn !== null && Number(edge.occurredOn.slice(0, 4)) !== edge.seasonYear)
        issue('Custody day must belong to its recorded season.');
      const lower = edge.occurredOn ?? `${edge.seasonYear}-01-01`;
      const upper = edge.occurredOn ?? `${edge.seasonYear}-12-31`;
      earliest = earliest > lower ? earliest : lower;
      if (earliest > upper) issue('Revision custody chronology is impossible.');
      holder = edge.toClubId;
      predecessor = edge.transferId;
    }
    if (
      state.exercise?.record.kind === 'exercise' &&
      state.exercise.record.terminalTransferId !== predecessor
    )
      issue('Exercise must reference this revision’s terminal custody transfer.');
  });

const fields = ['activation', 'award', 'custody', 'exercise'] as const;
const revisionContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-special-entitlement-revision/v1'),
    entitlementId: aflTradeContentAddressedIdSchema('special-draft-entitlement'),
    revision: z.number().int().positive(),
    supersedesRevisionId: revisionId.nullable(),
    reason: z.string().trim().min(1).max(4000),
    changedFields: z.array(z.enum(fields)),
    state: specialEntitlementRevisionStateSchema,
    proposedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((content, context) => {
    if (
      (content.revision === 1) !== (content.supersedesRevisionId === null) ||
      (content.revision === 1) !== (content.changedFields.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Initial revision has no predecessor or changed fields; corrections require both.',
      });
    }
    if (content.entitlementId !== content.state.award.award.entitlementId) {
      context.addIssue({
        code: 'custom',
        message: 'Revision identity must match the issuing right.',
      });
    }
    if (
      content.changedFields.some(
        (field, index) => index > 0 && content.changedFields[index - 1]! >= field
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Changed fields must be unique and sorted.' });
    }
  });

export const specialEntitlementRevisionSchema = z
  .object({
    revisionId,
    content: revisionContentSchema,
  })
  .strict()
  .superRefine((revision, context) => {
    if (
      revision.revisionId !==
      createAflTradeContentAddress('special-entitlement-revision', revision.content)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Revision digest must bind its complete reviewed state.',
      });
    }
  });

export function createSpecialEntitlementRevision(content: z.input<typeof revisionContentSchema>) {
  const parsed = revisionContentSchema.parse(content);
  return specialEntitlementRevisionSchema.parse({
    revisionId: createAflTradeContentAddress('special-entitlement-revision', parsed),
    content: parsed,
  });
}

/** Checks exact predecessor and declared differences only; never grants source/reviewer authority. */
export function validateSpecialEntitlementRevisionSuccessor(previous: unknown, next: unknown) {
  const before = specialEntitlementRevisionSchema.parse(previous);
  const after = specialEntitlementRevisionSchema.parse(next);
  if (
    after.content.entitlementId !== before.content.entitlementId ||
    after.content.state.award.award.content.environment !==
      before.content.state.award.award.content.environment ||
    after.content.supersedesRevisionId !== before.revisionId ||
    after.content.revision !== before.content.revision + 1 ||
    Date.parse(after.content.proposedAt) < Date.parse(before.content.proposedAt)
  ) {
    throw new TypeError(
      'Correction must follow its exact predecessor in the same right and environment.'
    );
  }
  const changes = fields.filter(
    (field) =>
      canonicalizeAflTradeJson(before.content.state[field]) !==
      canonicalizeAflTradeJson(after.content.state[field])
  );
  if (
    !changes.length ||
    canonicalizeAflTradeJson(changes) !== canonicalizeAflTradeJson(after.content.changedFields)
  ) {
    throw new TypeError(
      'Correction must declare its exact changed fields; no-op successors are invalid.'
    );
  }
  return {
    revision: after,
    changedFields: changes,
    authorityVerified: false as const,
    promotionEligible: false as const,
  };
}
