import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  parseAflTradeWorkbookTransactionReviewDecisionV2,
  type AflTradeWorkbookTransactionReviewDecisionV2,
} from './workbookTransactionReviewDecision';
import {
  parseAflTradeWorkbookTransactionReviewSet,
  type AflTradeWorkbookTransactionReviewSet,
} from './workbookTransactionReviewSet';
import { writeCanonicalAflTradeTransaction } from './canonicalTradeTransactionWriter';

export interface AflTradePrivateWorkbookAcquisitionSpellLineage {
  spellId: string;
  spellVersionId: string;
  ruleId: string;
  startEventVersionId: string;
  startAssetVersionId: string;
  startDate: string;
  endDate: null;
}

export interface AflTradePrivateWorkbookCanonicalTransactionLineage {
  eventId: string;
  eventVersionId: string;
  assets: readonly Readonly<{
    assetId: string;
    assetVersionId: string;
    acquisitionSpell: AflTradePrivateWorkbookAcquisitionSpellLineage | null;
  }>[];
}

export interface AflTradePrivateWorkbookTransactionPromotionReceipt {
  promotionId: string;
  workbookTradeId: string;
  reviewSetId: string;
  decisionId: string;
  canonicalTransaction: AflTradePrivateWorkbookCanonicalTransactionLineage;
  status: 'active';
  publicationEligible: false;
  publicationProhibited: true;
}

function importRowId(importRunId: string, stagingRowId: string): string {
  return createAflTradeContentAddress('import-row', { importRunId, stagingRowId });
}

export function parseAflTradePrivateWorkbookTransactionPromotionReceipt(
  input: unknown
): AflTradePrivateWorkbookTransactionPromotionReceipt | null {
  if (typeof input !== 'object' || input === null) return null;
  const receipt = input as Record<string, unknown>;
  const canonical = receipt.canonicalTransaction;
  if (
    receipt.schemaVersion !== 'afl-trade-private-workbook-transaction-promotion/v2' ||
    typeof receipt.workbookTradeId !== 'string' ||
    typeof receipt.reviewSetId !== 'string' ||
    typeof receipt.decisionId !== 'string' ||
    receipt.status !== 'active' ||
    receipt.publicationEligible !== false ||
    receipt.publicationProhibited !== true ||
    typeof canonical !== 'object' ||
    canonical === null ||
    typeof (canonical as Record<string, unknown>).eventId !== 'string' ||
    !/^event-version:[a-f0-9]{64}$/u.test(
      String((canonical as Record<string, unknown>).eventVersionId)
    ) ||
    !Array.isArray((canonical as Record<string, unknown>).assets)
  ) {
    return null;
  }
  const assets = (canonical as Record<string, unknown>).assets as unknown[];
  const validAssets = assets.every((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) return false;
    const asset = candidate as Record<string, unknown>;
    if (
      typeof asset.assetId !== 'string' ||
      !/^event-asset-version:[a-f0-9]{64}$/u.test(String(asset.assetVersionId))
    ) {
      return false;
    }
    if (asset.acquisitionSpell === null) return true;
    if (typeof asset.acquisitionSpell !== 'object') return false;
    const spell = asset.acquisitionSpell as Record<string, unknown>;
    return (
      /^acquisition-spell:[a-f0-9]{64}$/u.test(String(spell.spellId)) &&
      /^acquisition-spell-version:[a-f0-9]{64}$/u.test(String(spell.spellVersionId)) &&
      /^acquisition-spell-rule:[a-f0-9]{64}$/u.test(String(spell.ruleId)) &&
      spell.startEventVersionId === (canonical as Record<string, unknown>).eventVersionId &&
      spell.startAssetVersionId === asset.assetVersionId &&
      /^\d{4}-\d{2}-\d{2}$/u.test(String(spell.startDate)) &&
      spell.endDate === null
    );
  });
  if (
    !validAssets ||
    new Set(assets.map((asset) => (asset as Record<string, unknown>).assetId)).size !== assets.length
  ) {
    return null;
  }
  const promotionId = createAflTradeContentAddress(
    'private-workbook-transaction-promotion',
    receipt
  );
  return {
    promotionId,
    workbookTradeId: receipt.workbookTradeId,
    reviewSetId: receipt.reviewSetId,
    decisionId: receipt.decisionId,
    canonicalTransaction: canonical as unknown as AflTradePrivateWorkbookCanonicalTransactionLineage,
    status: 'active',
    publicationEligible: false,
    publicationProhibited: true,
  };
}

export function authenticateAflTradePrivateWorkbookTransactionPromotion(input: {
  readonly workbookTradeId: string;
  readonly reviewSetId: string;
  readonly promotionId: string;
  readonly decisionId: string;
  readonly decisionDocument: unknown;
  readonly receiptDocument: unknown;
}): Readonly<{
  decision: AflTradeWorkbookTransactionReviewDecisionV2;
  receipt: AflTradePrivateWorkbookTransactionPromotionReceipt;
}> {
  const decision = parseAflTradeWorkbookTransactionReviewDecisionV2(input.decisionDocument);
  const receipt = parseAflTradePrivateWorkbookTransactionPromotionReceipt(input.receiptDocument);
  if (
    receipt === null ||
    input.decisionId !== decision.decisionId ||
    input.promotionId !== receipt.promotionId ||
    input.reviewSetId !== decision.content.reviewSetId ||
    decision.content.workbookTradeId !== input.workbookTradeId ||
    receipt.workbookTradeId !== input.workbookTradeId ||
    receipt.reviewSetId !== input.reviewSetId ||
    receipt.decisionId !== decision.decisionId
  ) {
    throw new TypeError('Private workbook transaction promotion failed exact authentication.');
  }
  return { decision, receipt };
}

export class PostgresAflTradePrivateWorkbookTransactionPromotionRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async promote(input: {
    reviewSet: AflTradeWorkbookTransactionReviewSet;
    decision: AflTradeWorkbookTransactionReviewDecisionV2;
  }): Promise<AflTradePrivateWorkbookTransactionPromotionReceipt> {
    const reviewSet = parseAflTradeWorkbookTransactionReviewSet(input.reviewSet);
    const decision = parseAflTradeWorkbookTransactionReviewDecisionV2(input.decision);
    const subject = reviewSet.content.transactions.find(
      ({ reviewSubjectId }) => reviewSubjectId === decision.content.reviewSubjectId
    );
    if (
      !subject ||
      decision.content.reviewSetId !== reviewSet.reviewSetId ||
      decision.content.reviewSubjectSha256 !== sha256AflTradeCanonicalJson(subject)
    ) {
      throw new TypeError('Private transaction promotion must bind one exact reviewed subject.');
    }
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `private-workbook-transaction-promotion:${decision.content.workbookTradeId}`,
      ]);
      const replay = await transaction.query<{ receipt_json: unknown }>(
        `SELECT receipt_json
           FROM outcome_private_workbook_transaction_promotion
          WHERE decision_id=$1 AND status='active'
          FOR SHARE`,
        [decision.decisionId]
      );
      if (replay.rows.length === 1) {
        const receipt = parseAflTradePrivateWorkbookTransactionPromotionReceipt(
          replay.rows[0]!.receipt_json
        );
        if (
          !receipt ||
          receipt.workbookTradeId !== decision.content.workbookTradeId ||
          receipt.reviewSetId !== reviewSet.reviewSetId ||
          receipt.decisionId !== decision.decisionId
        ) {
          throw new TypeError('Private transaction promotion replay failed exact authentication.');
        }
        return receipt;
      }
      if (replay.rows.length > 1) {
        throw new TypeError('Private transaction promotion replay is ambiguous.');
      }

      const stored = await transaction.query<{ import_run_id: string; review_set_json: unknown }>(
        `SELECT import_run_id,review_set_json
           FROM outcome_workbook_transaction_review_set
          WHERE review_set_id=$1
          FOR SHARE`,
        [reviewSet.reviewSetId]
      );
      if (
        stored.rows.length !== 1 ||
        canonicalizeAflTradeJson(stored.rows[0]!.review_set_json) !==
          canonicalizeAflTradeJson(reviewSet)
      ) {
        throw new TypeError('Private transaction promotion requires the exact durable review set.');
      }
      const importRunId = stored.rows[0]!.import_run_id;
      if (!importRunId) {
        throw new TypeError('Private transaction promotion requires exact staged import ancestry.');
      }

      const subjectParties = new Map(
        subject.parties.map((party) => [party.stagingRowId, party] as const)
      );
      const clubNames = new Map<string, string>();
      for (const party of decision.content.parties) {
        const sourceParty = subjectParties.get(party.stagingRowId);
        if (!sourceParty) throw new TypeError('Canonical promotion lost a reviewed party row.');
        clubNames.set(party.canonicalClubId, sourceParty.clubLabel);
        for (const asset of party.assets) {
          if (asset.selection?.originalClubId) {
            clubNames.set(
              asset.selection.originalClubId,
              clubNames.get(asset.selection.originalClubId) ?? asset.selection.originalClubId
            );
          }
        }
      }
      for (const [clubId, currentName] of clubNames) {
        await transaction.query(
          `INSERT INTO outcome_club (club_id,current_name,status)
           VALUES ($1,$2,'approved') ON CONFLICT (club_id) DO NOTHING`,
          [clubId, currentName]
        );
        const exactClub = await transaction.query<{ club_id: string }>(
          `SELECT club_id FROM outcome_club
            WHERE club_id=$1 AND current_name=$2 AND status='approved' FOR SHARE`,
          [clubId, currentName]
        );
        if (exactClub.rows.length !== 1) {
          throw new TypeError('Canonical promotion club root conflicts with reviewed identity.');
        }
      }

      const canonicalAssets = decision.content.parties.flatMap((party) =>
        party.assets.map((asset) => ({ party, asset }))
      );
      const pickIdByAsset = new Map<string, string>();
      for (const { asset } of canonicalAssets) {
        if (asset.assetKind === 'player' && asset.canonicalPlayerId) {
          await transaction.query(
            `INSERT INTO outcome_player (player_id,display_name,status)
             VALUES ($1,$2,'approved') ON CONFLICT (player_id) DO NOTHING`,
            [asset.canonicalPlayerId, asset.sourceAssetText]
          );
          const exactPlayer = await transaction.query<{ player_id: string }>(
            `SELECT player_id FROM outcome_player
              WHERE player_id=$1 AND display_name=$2 AND status='approved' FOR SHARE`,
            [asset.canonicalPlayerId, asset.sourceAssetText]
          );
          if (exactPlayer.rows.length !== 1) {
            throw new TypeError('Canonical promotion player root conflicts with reviewed identity.');
          }
        } else if (asset.selection) {
          const pickId = createAflTradeContentAddress('draft-pick', {
            assetId: asset.assetId,
            selection: asset.selection,
          });
          await transaction.query(
            `INSERT INTO outcome_draft_pick
              (pick_id,draft_season_year,draft_kind,nominal_round,nominal_pick,original_club_id,status)
             VALUES ($1,$2,'national_draft',$3,$4,$5,'approved')
             ON CONFLICT (pick_id) DO NOTHING`,
            [
              pickId,
              asset.selection.seasonYear,
              asset.selection.round,
              asset.selection.number,
              asset.selection.originalClubId,
            ]
          );
          pickIdByAsset.set(asset.assetId, pickId);
        }
      }

      const eventId = createAflTradeContentAddress('event', {
        workbookTradeId: decision.content.workbookTradeId,
        reviewSetId: reviewSet.reviewSetId,
      });
      const written = await writeCanonicalAflTradeTransaction(transaction, {
        provenanceId: decision.decisionId,
        eventId,
        stableKey: `private-workbook:AFLM:${subject.seasonYear}:${decision.content.workbookTradeId}`,
        competition: 'AFLM',
        seasonYear: subject.seasonYear,
        occurredOn: decision.content.occurredOn,
        officialName: subject.sourceTitle,
        transactionSourceImportRowId: importRowId(importRunId, subject.transactionRowId),
        recordedAt: decision.content.decidedAt,
        parties: decision.content.parties.map((party) => ({
          clubId: party.canonicalClubId,
          sourceImportRowId: importRowId(importRunId, party.stagingRowId),
        })),
        assets: canonicalAssets.map(({ party, asset }) => ({
          assetKey: asset.assetId,
          kind:
            asset.assetKind === 'player'
              ? 'player'
              : asset.assetKind === 'pick'
                ? 'current_pick'
                : 'future_pick',
          playerId: asset.canonicalPlayerId,
          playerIdentityId: null,
          externalIdentityDecisionId: null,
          privateWorkbookTransactionDecisionId:
            asset.assetKind === 'player' ? decision.decisionId : null,
          pickId: pickIdByAsset.get(asset.assetId) ?? null,
          fromClubId: asset.sendingClubId,
          toClubId: asset.receivingClubId,
          sourceImportRowId: importRowId(importRunId, party.stagingRowId),
          rawDescription: asset.sourceAssetText,
        })),
      });

      const ruleDefinition = {
        schemaVersion: 'private-workbook-acquisition-spell-rule/v1',
        authority: 'private_workbook_canonical_transaction_review',
        start: 'exact approved transaction player asset',
        end: 'next approved departure event; null remains explicitly right-censored',
        publicationEligible: false,
        publicationProhibited: true,
      } as const;
      const ruleId = createAflTradeContentAddress('acquisition-spell-rule', ruleDefinition);
      await transaction.query(
        `INSERT INTO outcome_acquisition_spell_rule
          (rule_id,rule_version,definition_json,status,created_at)
         VALUES ($1,'private-workbook-acquisition-spell-rule/v1',$2::jsonb,'approved',$3)
         ON CONFLICT (rule_id) DO NOTHING`,
        [ruleId, canonicalizeAflTradeJson(ruleDefinition), decision.content.decidedAt]
      );

      const lineages: AflTradePrivateWorkbookCanonicalTransactionLineage['assets'][number][] = [];
      for (const [index, { asset }] of canonicalAssets.entries()) {
        const assetVersionId = written.assetVersionIds[index]!;
        if (asset.assetKind !== 'player' || !asset.canonicalPlayerId) {
          lineages.push({ assetId: asset.assetId, assetVersionId, acquisitionSpell: null });
          continue;
        }
        const spellId = createAflTradeContentAddress('acquisition-spell', {
          workbookTradeId: decision.content.workbookTradeId,
          assetId: asset.assetId,
        });
        const predecessor = await transaction.query<{
          spell_version_id: string;
          version: number | string;
        }>(
          `SELECT current_spell.spell_version_id,current_spell.version
             FROM outcome_acquisition_spell_version current_spell
            WHERE current_spell.spell_id=$1
              AND NOT EXISTS (
                SELECT 1 FROM outcome_acquisition_spell_version successor
                 WHERE successor.supersedes_spell_version_id=current_spell.spell_version_id
              )
            FOR SHARE`,
          [spellId]
        );
        if (predecessor.rows.length > 1) {
          throw new TypeError('Canonical acquisition spell has ambiguous current ancestry.');
        }
        const prior = predecessor.rows[0] ?? null;
        const version = prior ? Number(prior.version) + 1 : 1;
        const spellVersionContent = {
          decisionId: decision.decisionId,
          spellId,
          version,
          playerId: asset.canonicalPlayerId,
          clubId: asset.receivingClubId,
          startEventVersionId: written.eventVersionId,
          startAssetVersionId: assetVersionId,
          startDate: decision.content.occurredOn,
          endDate: null,
          ruleId,
          supersedesSpellVersionId: prior?.spell_version_id ?? null,
        } as const;
        const spellVersionId = createAflTradeContentAddress(
          'acquisition-spell-version',
          spellVersionContent
        );
        await transaction.query(
          `INSERT INTO outcome_acquisition_spell_version
            (spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,
             start_asset_version_id,start_date,end_date,end_reason,rule_id,status,
             supersedes_spell_version_id,recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,$9,'approved',$10,$11)`,
          [
            spellVersionId,
            spellId,
            version,
            asset.canonicalPlayerId,
            asset.receivingClubId,
            written.eventVersionId,
            assetVersionId,
            decision.content.occurredOn,
            ruleId,
            prior?.spell_version_id ?? null,
            decision.content.decidedAt,
          ]
        );
        lineages.push({
          assetId: asset.assetId,
          assetVersionId,
          acquisitionSpell: {
            spellId,
            spellVersionId,
            ruleId,
            startEventVersionId: written.eventVersionId,
            startAssetVersionId: assetVersionId,
            startDate: decision.content.occurredOn,
            endDate: null,
          },
        });
      }
      const canonicalTransaction = {
        eventId: written.eventId,
        eventVersionId: written.eventVersionId,
        assets: lineages,
      };
      const receiptContent = {
        schemaVersion: 'afl-trade-private-workbook-transaction-promotion/v2' as const,
        workbookTradeId: decision.content.workbookTradeId,
        reviewSetId: reviewSet.reviewSetId,
        decisionId: decision.decisionId,
        decisionSha256: sha256AflTradeCanonicalJson(decision),
        canonicalTransaction,
        status: 'active' as const,
        publicationEligible: false as const,
        publicationProhibited: true as const,
      };
      const receipt = {
        promotionId: createAflTradeContentAddress(
          'private-workbook-transaction-promotion',
          receiptContent
        ),
        ...receiptContent,
      };
      await transaction.query(
        `INSERT INTO outcome_private_workbook_transaction_promotion
          (promotion_id,workbook_trade_id,review_set_id,review_subject_id,decision_id,
           occurred_on,occurrence_precision,status,decision_sha256,decision_canonical_json,decision_json,
           receipt_sha256,receipt_canonical_json,receipt_json,recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10::jsonb,$11,$12,$13::jsonb,
                 statement_timestamp())
         ON CONFLICT (promotion_id) DO NOTHING`,
        [
          receipt.promotionId,
          receipt.workbookTradeId,
          receipt.reviewSetId,
          decision.content.reviewSubjectId,
          receipt.decisionId,
          decision.content.occurredOn,
          decision.content.occurrencePrecision,
          receiptContent.decisionSha256,
          canonicalizeAflTradeJson(decision),
          canonicalizeAflTradeJson(decision),
          receipt.promotionId.split(':')[1],
          canonicalizeAflTradeJson(receiptContent),
          canonicalizeAflTradeJson(receiptContent),
        ]
      );
      return {
        promotionId: receipt.promotionId,
        workbookTradeId: receipt.workbookTradeId,
        reviewSetId: receipt.reviewSetId,
        decisionId: receipt.decisionId,
        canonicalTransaction: receipt.canonicalTransaction,
        status: receipt.status,
        publicationEligible: false,
        publicationProhibited: true,
      };
    });
  }
}
