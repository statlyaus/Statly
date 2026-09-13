import { nonPlayerPickOutcomeSchema } from './nonPlayerPickOutcome';
import { z } from 'zod';
import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
} from '../artifacts/artifactReference';
import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import { parseAflTradeExternalReconciliationCandidate } from './externalReconciliationCandidateContracts';
import { specialEntitlementDateBounds } from './specialEntitlementLinkValidation';

const id = z.string().trim().min(1).max(240);
const year = z.number().int().min(1988).max(2200);
const pick = z.number().int().positive();
const historicalDate = z.union([
  z.iso.datetime({ offset: true }),
  z.object({ precision: z.literal('day'), date: z.iso.date() }).strict(),
  z.object({ precision: z.literal('year'), year }).strict(),
]);
const playerEndpoint = {
  playerId: id.nullable(),
  recordedPlayerName: z.string().trim().min(1).max(240),
  exercisingClubId: id.nullable(),
  draftYear: year.nullable(),
  draftType: z.string().trim().min(1).max(80).nullable(),
  livePick: pick.nullable(),
};

/** Terminal outcomes are factual lineage, not interchangeable player acquisitions. */
export const reviewedPickEndpointSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('selected'), ...playerEndpoint }).strict(),
  z.object({ kind: z.literal('rookie_elevation'), ...playerEndpoint }).strict(),
  ...nonPlayerPickOutcomeSchema.options,
]);

const movementSchema = z
  .object({
    transferId: aflTradeContentAddressedIdSchema('external-transfer').nullable(),
    fromClubId: id,
    toClubId: id,
    occurredAt: historicalDate,
    predecessorOrdinal: z.number().int().nonnegative().nullable(),
    source: z
      .object({
        nativeEventId: z.string().trim().min(1).max(500),
        sourceUrl: z.url(),
        retainedAssetLabel: z.string().trim().min(1).max(1000),
        artifact: aflTradeArtifactRefSchema,
        rowOrdinals: z
          .array(z.number().int().positive())
          .min(1)
          .max(100)
          .refine((rows) => new Set(rows).size === rows.length, 'Source rows must be unique.'),
      })
      .strict()
      .optional(),
  })
  .strict();

export const reviewedPickLineageSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-reviewed-pick-lineage/v1'),
    candidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
    transferId: aflTradeContentAddressedIdSchema('external-transfer'),
    // Source fields remain immutable; this is a separately evidenced correction.
    retainedSourceLabel: z.string().trim().min(1).max(1000),
    acceptedTradeTimePick: pick.nullable(),
    originalClubId: id.nullable(),
    movements: z.array(movementSchema).min(1).max(100),
    endpoint: reviewedPickEndpointSchema,
    attribution: z.enum(['direct', 'ultimate', 'package_only']),
    evidence: z.array(aflTradeArtifactRefSchema).min(1).max(100),
  })
  .strict()
  .superRefine((record, context) => {
    const fail = (message: string) => context.addIssue({ code: 'custom', message });
    if (new Set(record.evidence.map((ref) => ref.artifactId)).size !== record.evidence.length) {
      fail('Lineage evidence references must be unique.');
    }
    const transferIds = record.movements.flatMap((m) =>
      m.transferId === null ? [] : [m.transferId]
    );
    if (
      new Set(transferIds).size !== transferIds.length ||
      !transferIds.includes(record.transferId)
    ) {
      fail('The reviewed transfer must occur exactly once in a chain without duplicate transfers.');
    }
    let earliestPredecessor = Number.NEGATIVE_INFINITY;
    record.movements.forEach((movement, ordinal) => {
      if (movement.transferId === null && movement.source === undefined) {
        fail('A supplementary movement requires its exact retained source reference.');
      }
      if (
        movement.source &&
        !record.evidence.some((ref) =>
          doAflTradeArtifactRefsExactlyMatch(ref, movement.source!.artifact)
        )
      ) {
        fail('Every movement source must belong to the lineage evidence set.');
      }
      const bounds = specialEntitlementDateBounds(movement.occurredAt);
      if (earliestPredecessor > bounds.latest) fail('Custody dates admit no chronological chain.');
      earliestPredecessor = Math.max(earliestPredecessor, bounds.earliest);
      if (movement.fromClubId === movement.toClubId) fail('Custody movement must change holder.');
      if (movement.predecessorOrdinal !== (ordinal === 0 ? null : ordinal - 1)) {
        fail('Each movement must explicitly follow its preceding chain position.');
      }
      const previous = record.movements[ordinal - 1];
      if (!previous) return;
      if (previous.toClubId !== movement.fromClubId)
        fail('Custody holders must connect across every movement.');
      const before = specialEntitlementDateBounds(previous.occurredAt);
      const after = specialEntitlementDateBounds(movement.occurredAt);
      if (before.earliest > after.latest) fail('A predecessor cannot occur after its successor.');
    });
    const currentIndex = record.movements.findIndex((m) => m.transferId === record.transferId);
    if (record.attribution === 'direct' && currentIndex !== record.movements.length - 1) {
      fail('An asset moved onward cannot be labelled a direct endpoint of the reviewed transfer.');
    }
    if (
      (record.endpoint.kind === 'incorporated_into_later_package') !==
      (record.attribution === 'package_only')
    ) {
      fail('Later-package endpoints require package-only attribution.');
    }
    if (record.endpoint.kind === 'selected' || record.endpoint.kind === 'rookie_elevation') {
      const endpoint = record.endpoint;
      if (
        endpoint.exercisingClubId !== null &&
        endpoint.exercisingClubId !== record.movements.at(-1)!.toClubId
      ) {
        fail('The exercising club must be the last evidenced holder.');
      }
    }
    if (
      record.endpoint.kind !== 'incorporated_into_later_package' &&
      record.endpoint.draftYear !== null
    ) {
      const last = specialEntitlementDateBounds(record.movements.at(-1)!.occurredAt);
      if (last.year > record.endpoint.draftYear)
        fail('Custody cannot postdate the endpoint draft year.');
    }
  });

export type ReviewedPickLineage = z.infer<typeof reviewedPickLineageSchema>;

/** Binds reviewed facts to immutable candidate identities. Authority/readback belongs to the repository. */
export function bindReviewedPickLineage(candidateInput: unknown, recordsInput: readonly unknown[]) {
  const candidate = parseAflTradeExternalReconciliationCandidate(candidateInput);
  const records = recordsInput.map((record) => reviewedPickLineageSchema.parse(record));
  const transfers = new Map(candidate.content.transfers.map((t) => [t.transferId, t]));
  const transactions = new Map(candidate.content.transactions.map((t) => [t.transactionId, t]));
  if (new Set(records.map((r) => r.transferId)).size !== records.length) {
    throw new TypeError('Each transfer may have only one reviewed lineage.');
  }
  for (const record of records) {
    if (record.candidateId !== candidate.candidateId)
      throw new TypeError('Lineage must bind the exact candidate.');
    for (const movement of record.movements) {
      if (movement.transferId === null) continue;
      const transfer = transfers.get(movement.transferId);
      if (
        !transfer ||
        transfer.asset.kind === 'player' ||
        transfer.status === 'disputed' ||
        transfer.fromClubId !== movement.fromClubId ||
        transfer.toClubId !== movement.toClubId
      ) {
        throw new TypeError('Reviewed custody does not match a candidate pick transfer.');
      }
      const event = transactions.get(transfer.transactionId)!;
      if (movement.source && movement.source.nativeEventId !== event.providerEventId) {
        throw new TypeError('Movement source must identify the candidate transaction.');
      }
      const sourceAsset =
        transfer.asset.kind === 'special_entitlement' ? transfer.asset.sourceAsset : transfer.asset;
      const expectedLabel =
        sourceAsset.kind === 'special_pick'
          ? sourceAsset.sourceLabel
          : sourceAsset.kind === 'pick_entitlement'
            ? (sourceAsset.recordedLabel ??
              (sourceAsset.nominalPick === null ? null : `Pick ${sourceAsset.nominalPick}`))
            : null;
      if (
        movement.source &&
        expectedLabel !== null &&
        movement.source.retainedAssetLabel !== expectedLabel
      ) {
        throw new TypeError('Movement source must preserve the candidate asset label.');
      }
      const date = specialEntitlementDateBounds(movement.occurredAt);
      if (
        date.year !== event.seasonYear ||
        (date.day !== null && event.occurredOn !== null && date.day !== event.occurredOn)
      ) {
        throw new TypeError('Reviewed custody contradicts the candidate transaction date.');
      }
    }
    const current = transfers.get(record.transferId)!;
    const asset = current.asset;
    const sourceAsset = asset.kind === 'special_entitlement' ? asset.sourceAsset : asset;
    if (
      sourceAsset.kind === 'pick_entitlement' &&
      sourceAsset.originalClubId !== null &&
      record.originalClubId !== sourceAsset.originalClubId
    ) {
      throw new TypeError('Reviewed lineage must preserve the original club identity.');
    }
    const label =
      sourceAsset.kind === 'special_pick'
        ? sourceAsset.sourceLabel
        : sourceAsset.kind === 'pick_entitlement'
          ? (sourceAsset.recordedLabel ??
            (sourceAsset.nominalPick === null ? null : `Pick ${sourceAsset.nominalPick}`))
          : null;
    if (label !== null && label !== record.retainedSourceLabel) {
      throw new TypeError('Reviewed correction must retain the original candidate asset label.');
    }
  }
  return { candidateId: candidate.candidateId, records, canonicalAdmission: false as const };
}
