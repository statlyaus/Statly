import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import {
  AFL_TRADE_ACHIEVEMENT_RECONCILIATION_RUN_SCHEMA_VERSION,
  createAflTradeAchievementReconciliationRun,
  createAflTradeReconciledAchievement,
  createAflTradeReconciledAchievementSubjectKey,
  type AflTradeAchievementReconciliationPolicy,
  type AflTradeAchievementReconciliationRun,
} from './achievementReconciliationContracts';
import type { AflTradeSourceFact } from './factualObservationContracts';

type AchievementFact = AflTradeSourceFact & {
  content: Extract<AflTradeSourceFact['content'], { factKind: 'player_achievement' }>;
};

export interface ReconcileAflTradeAchievementsInput {
  policy: AflTradeAchievementReconciliationPolicy;
  sourceFacts: readonly AflTradeSourceFact[];
  expectedHeadRevisions: Readonly<Record<string, number>>;
  startedAt: string;
  completedAt: string;
}

interface AchievementGroup {
  key: string;
  facts: AchievementFact[];
}

function requireAchievementFacts(sourceFacts: readonly AflTradeSourceFact[]): AchievementFact[] {
  if (sourceFacts.length === 0) throw new Error('Achievement reconciliation needs source facts.');
  return sourceFacts.map((fact) => {
    if (fact.content.factKind !== 'player_achievement') {
      throw new Error('Achievement reconciliation cannot consume numeric or appearance facts.');
    }
    return fact as AchievementFact;
  });
}

function clubScope(fact: AchievementFact) {
  const sourceScope = fact.content.seasonClubScope;
  if (sourceScope.kind === 'resolved_single_club') {
    return { kind: 'resolved_single_club' as const, clubId: sourceScope.club.clubId };
  }
  return {
    kind: 'reviewed_unattributed' as const,
    clubId: null,
    reasonCode: sourceScope.reasonCode,
    decision: sourceScope.decision,
  };
}

function groupKey(fact: AchievementFact): string {
  return canonicalizeAflTradeJson({
    environment: fact.content.environment,
    competition: fact.content.competition,
    seasonYear: fact.content.seasonYear,
    playerId: fact.content.player.playerId,
    clubScope: clubScope(fact),
    achievementCode: fact.content.achievementCode,
    definition: fact.content.achievementDefinition,
    grain: fact.content.achievementGrain,
  });
}

function groupFacts(facts: AchievementFact[]): AchievementGroup[] {
  const grouped = new Map<string, AchievementFact[]>();
  for (const fact of facts) {
    const key = groupKey(fact);
    const values = grouped.get(key) ?? [];
    values.push(fact);
    grouped.set(key, values);
  }
  return [...grouped.entries()]
    .map(([key, values]) => ({
      key,
      facts: values.sort((left, right) => left.factId.localeCompare(right.factId)),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function selectedPriority(
  policy: AflTradeAchievementReconciliationPolicy,
  fact: AchievementFact
): number | null {
  const rule = policy.content.rules.find(
    ({ achievementCode }) => achievementCode === fact.content.achievementCode
  );
  const preference = rule?.sourcePreferences.find(
    ({ provider, capabilityId }) =>
      provider === fact.content.provider && capabilityId === fact.content.capabilityId
  );
  return preference?.priority ?? null;
}

function requireGroupPolicy(
  policy: AflTradeAchievementReconciliationPolicy,
  group: AchievementGroup
) {
  const first = group.facts[0];
  const rule = policy.content.rules.find(
    ({ achievementCode }) => achievementCode === first.content.achievementCode
  );
  if (!rule || rule.definition.id !== first.content.achievementDefinition.id) {
    throw new Error('Achievement source fact has no exact governed definition and rule.');
  }
  if (
    group.facts.some(
      (fact) =>
        fact.content.environment !== policy.content.environment ||
        fact.content.competition !== policy.content.competition ||
        fact.content.seasonYear < policy.content.validFromSeason ||
        fact.content.seasonYear > policy.content.validThroughSeason ||
        fact.content.achievementDefinition.id !== rule.definition.id
    )
  ) {
    throw new Error('Achievement source facts are outside the approved policy scope.');
  }
}

function unavailableState(group: AchievementGroup) {
  if (group.facts.some(({ content }) => content.availability.state === 'quarantined')) {
    return { state: 'quarantined' as const, reasonCode: 'source_fact_quarantined' as const };
  }
  if (group.facts.every(({ content }) => content.availability.state === 'not_applicable')) {
    return { state: 'not_applicable' as const, reasonCode: 'field_not_applicable' as const };
  }
  if (group.facts.some(({ content }) => content.availability.state === 'missing')) {
    return { state: 'unavailable' as const, reasonCode: 'source_value_missing' as const };
  }
  return { state: 'unavailable' as const, reasonCode: 'no_usable_approved_source' as const };
}

function reconcileGroup(
  policy: AflTradeAchievementReconciliationPolicy,
  group: AchievementGroup,
  completedAt: string
) {
  requireGroupPolicy(policy, group);
  const first = group.facts[0];
  const inputSourceFactIds = group.facts.map(({ factId }) => factId).sort();
  const usable = group.facts
    .map((fact) => ({ fact, priority: selectedPriority(policy, fact) }))
    .filter(
      (entry): entry is { fact: AchievementFact; priority: number } =>
        entry.priority !== null && entry.fact.content.availability.state === 'affirmed'
    );
  const minimumPriority =
    usable.length === 0 ? null : Math.min(...usable.map(({ priority }) => priority));
  const selected =
    minimumPriority === null
      ? []
      : usable.filter(({ priority }) => priority === minimumPriority).map(({ fact }) => fact);
  const selectedSourceFactIds = selected.map(({ factId }) => factId).sort();
  const values = new Map<string, string[]>();
  for (const fact of selected) {
    const availability = fact.content.availability;
    if (availability.state !== 'affirmed') continue;
    const ids = values.get(availability.evidenceValue) ?? [];
    ids.push(fact.factId);
    values.set(availability.evidenceValue, ids);
  }
  const alternatives = [...values.entries()]
    .map(([evidenceValue, sourceFactIds]) => ({
      evidenceValue,
      sourceFactIds: sourceFactIds.sort(),
    }))
    .sort((left, right) => left.evidenceValue.localeCompare(right.evidenceValue));
  const availability =
    alternatives.length === 1
      ? {
          state: 'affirmed' as const,
          evidenceValue: alternatives[0].evidenceValue,
          inputSourceFactIds,
          selectedSourceFactIds,
          reasonCode: null,
        }
      : alternatives.length > 1
        ? {
            state: 'conflicting' as const,
            evidenceValue: null,
            inputSourceFactIds,
            selectedSourceFactIds,
            alternatives,
            reasonCode: 'same_priority_sources_disagree' as const,
          }
        : {
            ...unavailableState(group),
            evidenceValue: null,
            inputSourceFactIds,
            selectedSourceFactIds: [],
          };
  return createAflTradeReconciledAchievement({
    schemaVersion: 'afl-trade-reconciled-achievement/v1',
    publicAssetBoundary: first.content.publicAssetBoundary,
    authorityBoundary: policy.content.authorityBoundary,
    publicationEligible: false,
    environment: first.content.environment,
    competition: first.content.competition,
    seasonYear: first.content.seasonYear,
    playerId: first.content.player.playerId,
    clubScope: clubScope(first),
    achievementCode: first.content.achievementCode,
    definition: first.content.achievementDefinition,
    grain: first.content.achievementGrain,
    availability,
    effectiveAt: first.content.effectiveAt,
    effectiveThrough: group.facts
      .map(({ content }) => content.effectiveAt)
      .sort()
      .at(-1)!,
    recordedAt: completedAt,
  });
}

export function reconcileAflTradeAchievements(
  input: ReconcileAflTradeAchievementsInput
): AflTradeAchievementReconciliationRun {
  const facts = requireAchievementFacts(input.sourceFacts);
  const policy = input.policy;
  if (Date.parse(input.completedAt) < Date.parse(input.startedAt)) {
    throw new Error('Achievement reconciliation completion predates its start.');
  }
  const groups = groupFacts(facts);
  const results = groups
    .map((group) => reconcileGroup(policy, group, input.completedAt))
    .sort((left, right) =>
      left.reconciledAchievementId.localeCompare(right.reconciledAchievementId)
    );
  const sourceMemberships = facts
    .slice()
    .sort((left, right) => left.factId.localeCompare(right.factId))
    .map((fact, index) => ({
      ordinal: index + 1,
      fact,
      factSha256: fact.factId.slice('source-fact:'.length),
    }));
  const headAdvances = results
    .map((result) => {
      const subjectKey = createAflTradeReconciledAchievementSubjectKey({
        environment: result.content.environment,
        competition: result.content.competition,
        seasonYear: result.content.seasonYear,
        playerId: result.content.playerId,
        clubScope: result.content.clubScope,
        achievementCode: result.content.achievementCode,
        grain: result.content.grain,
      });
      const expectedRevision = input.expectedHeadRevisions[subjectKey] ?? 0;
      return {
        subjectKey,
        expectedRevision,
        revision: expectedRevision + 1,
        reconciledAchievementId: result.reconciledAchievementId,
      };
    })
    .sort((left, right) => left.subjectKey.localeCompare(right.subjectKey));
  const counts = {
    sourceFacts: sourceMemberships.length,
    results: results.length,
    affirmed: results.filter(({ content }) => content.availability.state === 'affirmed').length,
    conflicting: results.filter(({ content }) => content.availability.state === 'conflicting')
      .length,
    unavailable: results.filter(({ content }) => content.availability.state === 'unavailable')
      .length,
    quarantined: results.filter(({ content }) => content.availability.state === 'quarantined')
      .length,
    notApplicable: results.filter(({ content }) => content.availability.state === 'not_applicable')
      .length,
  };
  return createAflTradeAchievementReconciliationRun({
    schemaVersion: AFL_TRADE_ACHIEVEMENT_RECONCILIATION_RUN_SCHEMA_VERSION,
    publicAssetBoundary: policy.content.publicAssetBoundary,
    authorityBoundary: policy.content.authorityBoundary,
    publicationEligible: false,
    environment: policy.content.environment,
    competition: policy.content.competition,
    seasonYear: facts[0].content.seasonYear,
    policyId: policy.policyId,
    policySha256: policy.policySha256,
    sourceMemberships,
    sourceSetSha256: sha256AflTradeCanonicalJson(sourceMemberships),
    results,
    resultSetSha256: sha256AflTradeCanonicalJson(results),
    headAdvances,
    counts,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  });
}
