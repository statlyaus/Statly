import { z } from 'zod';

import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';

const instantSchema = z.iso.datetime({ offset: true });
const dateSchema = z.iso.date();

const canonicalTransactionInputSchema = z
  .object({
    provenanceId: z.string().trim().min(1).max(512),
    eventId: z.string().trim().min(1).max(512),
    stableKey: z.string().trim().min(1).max(1_000),
    competition: z.string().trim().min(1).max(40),
    seasonYear: z.number().int().min(1897).max(2200),
    occurredOn: dateSchema,
    officialName: z.string().trim().min(1).max(1_000),
    transactionSourceImportRowId: z.string().trim().min(1).max(512),
    recordedAt: instantSchema,
    parties: z
      .array(
        z
          .object({
            clubId: z.string().trim().min(1).max(240),
            sourceImportRowId: z.string().trim().min(1).max(512),
          })
          .strict()
      )
      .min(2),
    assets: z
      .array(
        z
          .object({
            assetKey: z.string().trim().min(1).max(512),
            kind: z.enum(['player', 'current_pick', 'future_pick']),
            playerId: z.string().trim().min(1).max(512).nullable(),
            playerIdentityId: z.string().trim().min(1).max(512).nullable(),
            externalIdentityDecisionId: z.string().trim().min(1).max(512).nullable(),
            privateWorkbookTransactionDecisionId: z.string().trim().min(1).max(512).nullable(),
            pickId: z.string().trim().min(1).max(512).nullable(),
            fromClubId: z.string().trim().min(1).max(240),
            toClubId: z.string().trim().min(1).max(240),
            sourceImportRowId: z.string().trim().min(1).max(512),
            rawDescription: z.string().trim().min(1).max(4_000),
          })
          .strict()
      )
      .min(1),
  })
  .strict()
  .superRefine((input, context) => {
    if (Number(input.occurredOn.slice(0, 4)) !== input.seasonYear) {
      context.addIssue({
        code: 'custom',
        path: ['occurredOn'],
        message: 'Transaction date must fall within the exact transaction season.',
      });
    }
    const clubs = input.parties.map(({ clubId }) => clubId);
    if (new Set(clubs).size !== clubs.length) {
      context.addIssue({ code: 'custom', path: ['parties'], message: 'Parties must be unique.' });
    }
    const partySet = new Set(clubs);
    input.assets.forEach((asset, index) => {
      if (
        !partySet.has(asset.fromClubId) ||
        !partySet.has(asset.toClubId) ||
        asset.fromClubId === asset.toClubId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assets', index],
          message: 'Every asset must be directed between two exact transaction parties.',
        });
      }
      const playerIdentityCount = Number(asset.playerIdentityId !== null) +
        Number(asset.externalIdentityDecisionId !== null) +
        Number(asset.privateWorkbookTransactionDecisionId !== null);
      if (
        (asset.kind === 'player' &&
          (asset.playerId === null || playerIdentityCount !== 1 || asset.pickId !== null)) ||
        (asset.kind !== 'player' &&
          (asset.playerId !== null || playerIdentityCount !== 0 || asset.pickId === null))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assets', index],
          message: 'Asset identity payload must match its canonical kind.',
        });
      }
    });
  });

export type CanonicalAflTradeTransactionInput = z.input<
  typeof canonicalTransactionInputSchema
>;

export interface WrittenCanonicalAflTradeTransaction {
  eventId: string;
  eventVersionId: string;
  version: number;
  supersedesVersionId: string | null;
  assetVersionIds: readonly string[];
}

export async function writeCanonicalAflTradeTransaction(
  transaction: AflOutcomeSqlTransaction,
  unparsedInput: CanonicalAflTradeTransactionInput
): Promise<WrittenCanonicalAflTradeTransaction> {
  const input = canonicalTransactionInputSchema.parse(unparsedInput);
  await transaction.query(
    `INSERT INTO outcome_event (event_id,competition,season_year,stable_key)
     VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO NOTHING`,
    [input.eventId, input.competition, input.seasonYear, input.stableKey]
  );
  const exactRoot = await transaction.query(
    `SELECT event_id FROM outcome_event
      WHERE event_id=$1 AND competition=$2 AND season_year=$3 AND stable_key=$4
      FOR SHARE`,
    [input.eventId, input.competition, input.seasonYear, input.stableKey]
  );
  if (exactRoot.rows.length !== 1) {
    throw new TypeError('Canonical transaction event root conflicts with existing scope.');
  }

  const current = await transaction.query<{
    event_version_id: string;
    version: number | string;
    recorded_at: Date | string;
  }>(
    `SELECT current.event_version_id,current.version,current.recorded_at
       FROM outcome_event_version current
       LEFT JOIN outcome_event_version superseded_by
         ON superseded_by.supersedes_version_id=current.event_version_id
      WHERE current.event_id=$1 AND superseded_by.event_version_id IS NULL
      FOR SHARE OF current`,
    [input.eventId]
  );
  if (current.rows.length > 1) {
    throw new TypeError('Canonical transaction has more than one current event version.');
  }
  const predecessor = current.rows[0] ?? null;
  if (predecessor && new Date(predecessor.recorded_at) > new Date(input.recordedAt)) {
    throw new TypeError('Canonical transaction correction cannot be backdated.');
  }
  const version = predecessor ? Number(predecessor.version) + 1 : 1;
  const supersedesVersionId = predecessor?.event_version_id ?? null;
  const eventVersionId = createAflTradeContentAddress('event-version', {
    provenanceId: input.provenanceId,
    eventId: input.eventId,
    version,
    supersedesVersionId,
    occurredOn: input.occurredOn,
    officialName: input.officialName,
    parties: input.parties,
    assets: input.assets,
  });
  await transaction.query(
    `INSERT INTO outcome_event_version
      (event_version_id,event_id,version,kind,acquisition_mechanism,event_date,
       official_name,status,source_import_row_id,supersedes_version_id,recorded_at)
     VALUES ($1,$2,$3,'trade'::"OutcomeEventKind",'trade'::"OutcomeAcquisitionMechanism",$4,$5,
             'approved'::"OutcomeRecordStatus",$6,$7,$8)`,
    [
      eventVersionId,
      input.eventId,
      version,
      input.occurredOn,
      input.officialName,
      input.transactionSourceImportRowId,
      supersedesVersionId,
      input.recordedAt,
    ]
  );
  for (const [ordinal, party] of input.parties.entries()) {
    await transaction.query(
      `INSERT INTO outcome_event_party
        (event_version_id,club_id,source_import_row_id,role,ordinal)
       VALUES ($1,$2,$3,'party',$4)`,
      [eventVersionId, party.clubId, party.sourceImportRowId, ordinal + 1]
    );
  }
  const assetVersionIds: string[] = [];
  for (const asset of input.assets) {
    const assetVersionId = createAflTradeContentAddress('event-asset-version', {
      provenanceId: input.provenanceId,
      eventVersionId,
      assetKey: asset.assetKey,
    });
    await transaction.query(
      `INSERT INTO outcome_event_asset
        (asset_version_id,event_version_id,asset_key,kind,player_id,player_identity_id,
         external_identity_decision_id,private_workbook_transaction_decision_id,pick_id,
         from_club_id,to_club_id,source_import_row_id,raw_description,status)
       VALUES ($1,$2,$3,$4::"OutcomeAssetKind",$5,$6,$7,$8,$9,$10,$11,$12,$13,
               'approved'::"OutcomeRecordStatus")`,
      [
        assetVersionId,
        eventVersionId,
        asset.assetKey,
        asset.kind,
        asset.playerId,
        asset.playerIdentityId,
        asset.externalIdentityDecisionId,
        asset.privateWorkbookTransactionDecisionId,
        asset.pickId,
        asset.fromClubId,
        asset.toClubId,
        asset.sourceImportRowId,
        asset.rawDescription,
      ]
    );
    assetVersionIds.push(assetVersionId);
  }
  return { eventId: input.eventId, eventVersionId, version, supersedesVersionId, assetVersionIds };
}
