import {
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  aflTradeAcquisitionSpellRegistrationSchema,
  type AflTradeAcquisitionSpellRegistration,
  aflTradeAcquisitionSpellRegistrationRuleSchema,
  type AflTradeAcquisitionSpellRegistrationRule,
} from './acquisitionSpellRegistrationContracts';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from './postgresOutcomeReleaseRepository';

export interface AflTradeAcquisitionRegistrationEvidenceReader {
  read(reference: AflTradeArtifactRef): Promise<Uint8Array>;
}

export interface AflTradeAcquisitionRegistrationExecution {
  readonly environment: 'test_fixture' | 'non_production';
  readonly competition: 'AFLM' | 'AFLW';
}

/** Writes only proposals already approved by the existing review owner. */
export class PostgresAflTradeAcquisitionSpellRegistrationRepository {
  constructor(
    private readonly database: AflOutcomeSqlClient,
    private readonly evidence: AflTradeAcquisitionRegistrationEvidenceReader
  ) {}

  async registerReviewedRule(
    input: AflTradeAcquisitionSpellRegistrationRule,
    approvalDecisionId: string,
    execution: AflTradeAcquisitionRegistrationExecution
  ): Promise<AflTradeAcquisitionSpellRegistrationRule> {
    const rule = aflTradeAcquisitionSpellRegistrationRuleSchema.parse(input);
    if (
      rule.content.environment !== execution.environment ||
      rule.content.competition !== execution.competition
    )
      throw new Error('Acquisition rule registration scope differs.');
    for (const ref of rule.content.evidence) {
      if (!doesAflTradeArtifactRefMatchBytes(ref, await this.evidence.read(ref))) {
        throw new Error('Acquisition rule evidence bytes differ.');
      }
    }
    return this.database.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-review-subject:acquisition_spell_rule:${rule.ruleId}`,
      ]);
      await transaction.query(
        `INSERT INTO outcome_acquisition_spell_rule
          (rule_id,rule_version,definition_json,status,created_at,
           registration_canonical_json,registration_approval_decision_id,registered_at)
         VALUES ($1,$2,$3::jsonb,'approved',$4,$5,$6,
           date_trunc('milliseconds',transaction_timestamp()))
         ON CONFLICT (rule_id) DO NOTHING`,
        [
          rule.ruleId,
          rule.content.ruleVersion,
          canonicalizeAflTradeJson(rule),
          rule.content.createdAt,
          canonicalizeAflTradeJson(rule.content),
          approvalDecisionId,
        ]
      );
      const result = await transaction.query<{ definition_json: unknown }>(
        `SELECT definition_json FROM outcome_acquisition_spell_rule
         WHERE rule_id=$1 AND definition_json=$2::jsonb
           AND registration_approval_decision_id=$3
           AND outcome_acquisition_rule_registration_current(rule_id,transaction_timestamp())
         FOR SHARE`,
        [rule.ruleId, canonicalizeAflTradeJson(rule), approvalDecisionId]
      );
      if (result.rows.length !== 1)
        throw new Error('Acquisition rule authority is not current and exact.');
      return aflTradeAcquisitionSpellRegistrationRuleSchema.parse(result.rows[0]!.definition_json);
    });
  }

  async registerReviewedSpell(
    input: AflTradeAcquisitionSpellRegistration,
    approvalDecisionId: string,
    execution: AflTradeAcquisitionRegistrationExecution
  ): Promise<AflTradeAcquisitionSpellRegistration> {
    const spell = aflTradeAcquisitionSpellRegistrationSchema.parse(input);
    await this.authenticateSpell(spell, execution);
    return this.database.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-review-subject:acquisition_spell_registration:${spell.spellVersionId}`,
      ]);
      const c = spell.content;
      await this.authenticateRule(transaction, c.ruleId);
      if (c.schemaVersion === 'afl-trade-acquisition-registration/v3') {
        // Appearance membership: no entry event; the window is the first and last reviewed
        // appearance in one season, verified against appearance facts by the database guard.
        await transaction.query(
          `INSERT INTO outcome_acquisition_spell_version
            (spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,
             start_asset_version_id,start_date,end_date,end_reason,rule_id,status,
             supersedes_spell_version_id,recorded_at,registration_canonical_json,
             registration_approval_decision_id,registered_at)
           SELECT $1,COALESCE((SELECT spell_id FROM outcome_acquisition_spell_version
                      WHERE spell_version_id=$2),$1),$3,$4,$5,NULL,NULL,$6::date,$7::date,
             'last_reviewed_appearance_in_season',$8,'approved',$2,$9,$10,$11,
             date_trunc('milliseconds',transaction_timestamp())
           WHERE NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_version WHERE spell_version_id=$1)
           ON CONFLICT (spell_version_id) DO NOTHING`,
          [
            spell.spellVersionId,
            c.supersedesSpellVersionId,
            c.version,
            c.playerId,
            c.clubId,
            c.firstAppearance.date,
            c.lastAppearance.date,
            c.ruleId,
            c.createdAt,
            canonicalizeAflTradeJson(c),
            approvalDecisionId,
          ]
        );
        return this.requireRegistered(transaction, spell, approvalDecisionId);
      }
      await transaction.query(
        `INSERT INTO outcome_acquisition_spell_version
          (spell_version_id,spell_id,version,player_id,club_id,start_event_version_id,
           start_asset_version_id,start_date,end_date,end_reason,rule_id,status,
           supersedes_spell_version_id,recorded_at,registration_canonical_json,
           registration_approval_decision_id,registered_at)
         SELECT $1,COALESCE((SELECT spell_id FROM outcome_acquisition_spell_version
                    WHERE spell_version_id=$2),$1),$3,$4,$5,$6,$7,$8::date,
           CASE WHEN $9::date IS NULL THEN NULL ELSE $9::date-1 END,
           CASE WHEN $12::text::jsonb->'departure'='null'::jsonb THEN NULL ELSE 'reviewed_departure' END,
           $10,'approved',$2,$11,$12,$13,date_trunc('milliseconds',transaction_timestamp())
         WHERE NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_version WHERE spell_version_id=$1)
         ON CONFLICT (spell_version_id) DO NOTHING`,
        [
          spell.spellVersionId,
          c.supersedesSpellVersionId,
          c.version,
          c.playerId,
          c.clubId,
          c.entry.eventVersionId,
          c.entry.assetVersionId,
          c.entry.eventDate,
          c.departure?.eventDate ?? null,
          c.ruleId,
          c.createdAt,
          canonicalizeAflTradeJson(c),
          approvalDecisionId,
        ]
      );
      return this.requireRegistered(transaction, spell, approvalDecisionId);
    });
  }

  private async requireRegistered(
    transaction: AflOutcomeSqlTransaction,
    spell: AflTradeAcquisitionSpellRegistration,
    approvalDecisionId: string
  ): Promise<AflTradeAcquisitionSpellRegistration> {
    const result = await transaction.query<{ registration_canonical_json: string }>(
      `SELECT registration_canonical_json FROM outcome_acquisition_spell_version
       WHERE spell_version_id=$1 AND registration_canonical_json=$2
         AND registration_approval_decision_id=$3
         AND outcome_acquisition_spell_registration_current(spell_version_id,transaction_timestamp())
       FOR SHARE`,
      [spell.spellVersionId, canonicalizeAflTradeJson(spell.content), approvalDecisionId]
    );
    if (result.rows.length !== 1)
      throw new Error('Acquisition spell authority is not current and exact.');
    return spell;
  }

  async loadCurrentExact(
    spellVersionId: string,
    execution: AflTradeAcquisitionRegistrationExecution
  ): Promise<AflTradeAcquisitionSpellRegistration> {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<{ registration_canonical_json: string }>(
        `SELECT registration_canonical_json FROM outcome_acquisition_spell_version
         WHERE spell_version_id=$1
           AND outcome_acquisition_spell_registration_current(spell_version_id,transaction_timestamp())
         FOR SHARE`,
        [spellVersionId]
      );
      if (result.rows.length !== 1)
        throw new Error('Acquisition spell authority is not current and exact.');
      const spell = aflTradeAcquisitionSpellRegistrationSchema.parse({
        spellVersionId,
        content: JSON.parse(result.rows[0]!.registration_canonical_json),
      });
      await this.authenticateSpell(spell, execution);
      await this.authenticateRule(transaction, spell.content.ruleId);
      return spell;
    });
  }

  private async authenticateRule(
    transaction: AflOutcomeSqlTransaction,
    ruleId: string
  ): Promise<void> {
    const result = await transaction.query<{ definition_json: unknown }>(
      `SELECT definition_json FROM outcome_acquisition_spell_rule
       WHERE rule_id=$1 AND outcome_acquisition_rule_registration_current(rule_id,transaction_timestamp())
       FOR SHARE`,
      [ruleId]
    );
    if (result.rows.length !== 1)
      throw new Error('Acquisition rule authority is not current and exact.');
    const rule = aflTradeAcquisitionSpellRegistrationRuleSchema.parse(
      result.rows[0]!.definition_json
    );
    for (const ref of rule.content.evidence) {
      if (!doesAflTradeArtifactRefMatchBytes(ref, await this.evidence.read(ref)))
        throw new Error('Acquisition rule evidence bytes differ.');
    }
  }

  private async authenticateSpell(
    spell: AflTradeAcquisitionSpellRegistration,
    execution: AflTradeAcquisitionRegistrationExecution
  ): Promise<void> {
    const c = spell.content;
    if (c.environment !== execution.environment || c.competition !== execution.competition)
      throw new Error('Acquisition spell registration scope differs.');
    // Appearance membership (v3) binds reviewed appearance facts, which the database authenticates;
    // it carries no retained evidence bytes of its own.
    if (c.schemaVersion === 'afl-trade-acquisition-registration/v3') return;
    for (const ref of [
      ...c.entry.evidence,
      ...c.continuityEvidence,
      ...(c.departure?.evidence ?? []),
    ]) {
      if (!doesAflTradeArtifactRefMatchBytes(ref, await this.evidence.read(ref)))
        throw new Error('Acquisition spell evidence bytes differ.');
    }
  }
}
