import { describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  appendAflTradeGateDecision,
  resolveAflTradeGateEligibility,
  validateAflTradeGateDecisionLedger,
  type AflTradeGateDecisionLedger,
} from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import {
  aflTradeGovernedArtifactRefSchema,
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordContentSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateDecisionProposal,
  type AflTradeGateDecisionRecord,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';

const refs = {
  authority: `artifact:${'a'.repeat(64)}`,
  reviewer: `artifact:${'b'.repeat(64)}`,
  condition: `artifact:${'c'.repeat(64)}`,
};

function proposal(version = 1): AflTradeGateDecisionProposal {
  const content = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey: 'fixture-source-evaluation',
    version,
    environment: 'test_fixture' as const,
    scope: {
      scopeKey: 'fixture-source-evaluation',
      description: 'A fabricated source-evaluation scope used only in unit tests.',
      dimensions: [
        { name: 'operation', values: ['bounded_evaluation_capture'] },
        { name: 'season', values: ['fixture-season'] },
      ],
      exclusions: ['All production evidence and operations'],
    },
    proposal: 'Permit a bounded fabricated evaluation for deterministic contract tests.',
    alternativesConsidered: ['Keep the fabricated evaluation blocked.'],
    accountableOwner: 'fixture-data-owner',
    reviewRequirement: 'independent_review_required' as const,
    requiredReviewerRoles: ['fixture-data-reviewer'],
    conditions: [
      {
        conditionId: 'fixture-condition',
        description: 'Use fabricated evidence only.',
        required: true,
        verificationEvidenceIds: [refs.condition],
      },
    ],
    evidenceIds: [refs.authority],
    affectedArtifacts: [],
    proposedAt: `2026-08-0${version}T00:00:00.000Z`,
    proposedBy: 'fixture-proposer',
    proposalOrigin: 'agent_assisted' as const,
  };
  return aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', content),
    content,
  });
}

function decision(
  sourceProposal: AflTradeGateDecisionProposal,
  options: {
    state?: 'pending' | 'approved' | 'blocked' | 'expired' | 'withdrawn';
    supersedesDecisionId?: string | null;
    conditionStatus?: 'satisfied' | 'unsatisfied' | 'not_applicable';
    reviewerId?: string;
    effectiveAt?: string;
    revalidateAt?: string | null;
  } = {}
): AflTradeGateDecisionRecord {
  const state = options.state ?? 'approved';
  const pending = state === 'pending';
  const content = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: sourceProposal.proposalId,
    gate: sourceProposal.content.gate,
    decisionKey: sourceProposal.content.decisionKey,
    version: sourceProposal.content.version,
    environment: sourceProposal.content.environment,
    scope: sourceProposal.content.scope,
    state,
    authorityKind: 'fixture' as const,
    accountableOwner: sourceProposal.content.accountableOwner,
    decidedBy: pending ? null : 'fixture-data-owner',
    reviewers: pending
      ? []
      : [
          {
            reviewerId: options.reviewerId ?? 'fixture-independent-reviewer',
            role: 'fixture-data-reviewer',
            evidenceId: refs.reviewer,
          },
        ],
    authorityEvidenceIds: pending ? [] : [refs.authority],
    conditionResults: [
      {
        conditionId: 'fixture-condition',
        status: options.conditionStatus ?? 'satisfied',
        evidenceIds: [refs.condition],
        explanation: 'The fabricated-only condition was mechanically evaluated.',
      },
    ],
    rationale: pending ? null : `The fabricated ${state} decision is evidence-backed for tests.`,
    limitations: ['This decision has no production authority.'],
    decidedAt: pending ? null : `2026-08-0${sourceProposal.content.version}T01:00:00.000Z`,
    effectiveAt: pending
      ? null
      : (options.effectiveAt ?? `2026-08-0${sourceProposal.content.version}T02:00:00.000Z`),
    revalidateAt: pending ? null : (options.revalidateAt ?? '2027-08-01T00:00:00.000Z'),
    supersedesDecisionId: options.supersedesDecisionId ?? null,
    affectedArtifacts: sourceProposal.content.affectedArtifacts,
    withdrawalActions:
      state === 'withdrawn' ? ['Keep all fabricated evaluation work blocked.'] : [],
  };
  return aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', content),
    content,
  });
}

function ledger(
  proposals: readonly AflTradeGateDecisionProposal[],
  decisions: readonly AflTradeGateDecisionRecord[]
): AflTradeGateDecisionLedger {
  return { proposals, decisions };
}

describe('AFL trade-intelligence gate decisions', () => {
  it('canonicalizes equivalent JSON objects to the same content address', () => {
    const left = { beta: [2, { zeta: true, alpha: null }], alpha: 'value' };
    const right = { alpha: 'value', beta: [2, { alpha: null, zeta: true }] };

    expect(canonicalizeAflTradeJson(left)).toBe(canonicalizeAflTradeJson(right));
    expect(createAflTradeContentAddress('fixture', left)).toBe(
      createAflTradeContentAddress('fixture', right)
    );
  });

  it('rejects unsupported canonical JSON values and altered hashed content', () => {
    expect(() => canonicalizeAflTradeJson({ invalid: undefined })).toThrow();
    expect(() => canonicalizeAflTradeJson([Number.NaN])).toThrow();

    const valid = proposal();
    expect(
      aflTradeGateDecisionProposalSchema.safeParse({
        ...valid,
        content: { ...valid.content, proposal: 'Altered after hashing.' },
      }).success
    ).toBe(false);
  });

  it('rejects a decision mutated after content addressing before eligibility resolution', () => {
    const proposed = proposal();
    const blocked = decision(proposed, { state: 'blocked' });
    const mutated = {
      ...blocked,
      content: { ...blocked.content, state: 'approved' as const },
    };
    const fixtureLedger = ledger([proposed], [mutated]);

    expect(validateAflTradeGateDecisionLedger(fixtureLedger).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_decision' })
    );
    expect(
      resolveAflTradeGateEligibility(fixtureLedger, {
        gate: proposed.content.gate,
        decisionKey: proposed.content.decisionKey,
        environment: 'test_fixture',
        evaluatedAt: '2026-08-03T00:00:00.000Z',
      }).blockers
    ).toEqual([expect.objectContaining({ code: 'invalid_ledger' })]);
  });

  it('requires governed artifact kinds to match their content-address prefixes', () => {
    const base = proposal().content;
    const content = {
      ...base,
      affectedArtifacts: [
        { kind: 'source_rights' as const, artifactId: `dataset:${'d'.repeat(64)}` },
      ],
    };

    expect(
      aflTradeGateDecisionProposalSchema.safeParse({
        proposalId: createAflTradeContentAddress('gate-proposal', content),
        content,
      }).success
    ).toBe(false);
  });

  it.each([
    ['valuation_bundle', 'valuation-bundle'],
    ['model_qualification', 'model-qualification'],
    ['architecture_current_state', 'architecture-current-state'],
    ['architecture_decision_package', 'architecture-decision-package'],
    ['authority_transition', 'authority-transition'],
    ['factual_release_candidate', 'factual-release-candidate'],
    ['corpus_factual_lineage', 'corpus-factual-lineage'],
  ] as const)('enforces the %s artifact content-address prefix', (kind, prefix) => {
    expect(
      aflTradeGovernedArtifactRefSchema.safeParse({
        kind,
        artifactId: `${prefix}:${'d'.repeat(64)}`,
      }).success
    ).toBe(true);
    expect(
      aflTradeGovernedArtifactRefSchema.safeParse({
        kind,
        artifactId: `evidence:${'d'.repeat(64)}`,
      }).success
    ).toBe(false);
  });

  it('rejects duplicate governed artifact references', () => {
    const base = proposal().content;
    const reference = {
      kind: 'source_rights' as const,
      artifactId: `source-rights:${'d'.repeat(64)}`,
    };
    const content = { ...base, affectedArtifacts: [reference, reference] };

    expect(
      aflTradeGateDecisionProposalSchema.safeParse({
        proposalId: createAflTradeContentAddress('gate-proposal', content),
        content,
      }).success
    ).toBe(false);
  });

  it('resolves a valid fixture approval as mechanically eligible only in its environment', () => {
    const proposed = proposal();
    const decided = decision(proposed);
    const fixtureLedger = ledger([proposed], [decided]);

    expect(validateAflTradeGateDecisionLedger(fixtureLedger)).toEqual({ valid: true, issues: [] });
    expect(
      resolveAflTradeGateEligibility(fixtureLedger, {
        gate: proposed.content.gate,
        decisionKey: proposed.content.decisionKey,
        environment: 'test_fixture',
        evaluatedAt: '2026-08-03T00:00:00.000Z',
      }).status
    ).toBe('mechanically_eligible');
    expect(
      resolveAflTradeGateEligibility(fixtureLedger, {
        gate: proposed.content.gate,
        decisionKey: proposed.content.decisionKey,
        environment: 'production',
        evaluatedAt: '2026-08-03T00:00:00.000Z',
      }).blockers
    ).toContainEqual(expect.objectContaining({ code: 'environment_mismatch' }));
  });

  it('preserves ordered ledger issues across duplicate and missing references', () => {
    const firstProposal = proposal(1);
    const firstDecision = decision(firstProposal);
    const unregisteredProposal = proposal(2);
    const unregisteredDecision = decision(unregisteredProposal);
    const result = validateAflTradeGateDecisionLedger(
      ledger([firstProposal, firstProposal], [firstDecision, firstDecision, unregisteredDecision])
    );
    const proposalVersionKey = [
      firstProposal.content.gate,
      firstProposal.content.environment,
      firstProposal.content.decisionKey,
      firstProposal.content.version,
    ].join('|');
    const decisionVersionKey = [
      firstDecision.content.gate,
      firstDecision.content.environment,
      firstDecision.content.decisionKey,
      firstDecision.content.version,
    ].join('|');

    expect(result).toEqual({
      valid: false,
      issues: [
        {
          code: 'duplicate_proposal',
          subjectId: firstProposal.proposalId,
          message: `Proposal ${firstProposal.proposalId} is duplicated.`,
        },
        {
          code: 'duplicate_decision',
          subjectId: firstDecision.decisionId,
          message: `Decision ${firstDecision.decisionId} is duplicated.`,
        },
        {
          code: 'duplicate_version',
          subjectId: proposalVersionKey,
          message: `Proposal version ${proposalVersionKey} is duplicated.`,
        },
        {
          code: 'duplicate_version',
          subjectId: decisionVersionKey,
          message: `Decision version ${decisionVersionKey} is duplicated.`,
        },
        {
          code: 'missing_proposal',
          subjectId: unregisteredDecision.decisionId,
          message: `Decision ${unregisteredDecision.decisionId} references a missing proposal.`,
        },
      ],
    });
  });

  it('rejects fixture authority on a production decision record', () => {
    const proposed = proposal();
    const decided = decision(proposed);
    const content = { ...decided.content, environment: 'production' as const };

    expect(
      aflTradeGateDecisionRecordSchema.safeParse({
        decisionId: createAflTradeContentAddress('gate-decision', content),
        content,
      }).success
    ).toBe(false);
  });

  it('permits non-expiring automated authority only for non-production Gate 3 validity', () => {
    const qualificationId = createAflTradeContentAddress('model-qualification', 'qualification');
    const runId = createAflTradeContentAddress('model-run', 'qualified-run');
    const proposalContent = {
      ...proposal().content,
      gate: 'gate_3_model_validity' as const,
      decisionKey: 'automated-player-model-validity',
      environment: 'non_production' as const,
      scope: {
        scopeKey: 'afl-men:2026-trades',
        description: 'Exact automated model validity for one qualified component run.',
        dimensions: [],
        exclusions: [],
      },
      reviewRequirement: 'accountable_owner_only' as const,
      requiredReviewerRoles: [],
      conditions: [],
      affectedArtifacts: [
        { kind: 'model_run' as const, artifactId: runId },
        { kind: 'model_qualification' as const, artifactId: qualificationId },
      ],
    };
    const automatedProposal = aflTradeGateDecisionProposalSchema.parse({
      proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
      content: proposalContent,
    });
    const decisionContent = {
      schemaVersion: 'afl-trade-gate-decision/v1' as const,
      proposalId: automatedProposal.proposalId,
      gate: automatedProposal.content.gate,
      decisionKey: automatedProposal.content.decisionKey,
      version: 1,
      environment: automatedProposal.content.environment,
      scope: automatedProposal.content.scope,
      state: 'approved' as const,
      authorityKind: 'automated_validation_record' as const,
      accountableOwner: automatedProposal.content.accountableOwner,
      decidedBy: 'statly-model-qualification-agent',
      reviewers: [],
      authorityEvidenceIds: [refs.authority],
      conditionResults: [],
      rationale: 'The exact retained model-pair qualification recomputed successfully.',
      limitations: ['Private non-production model validity only.'],
      decidedAt: '2026-08-21T09:00:00.000Z',
      effectiveAt: '2026-08-21T09:00:00.000Z',
      revalidateAt: null,
      supersedesDecisionId: null,
      affectedArtifacts: automatedProposal.content.affectedArtifacts,
      withdrawalActions: [],
    };
    const automatedDecision = aflTradeGateDecisionRecordSchema.parse({
      decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
      content: decisionContent,
    });
    const automatedLedger = ledger([automatedProposal], [automatedDecision]);

    expect(validateAflTradeGateDecisionLedger(automatedLedger)).toEqual({
      valid: true,
      issues: [],
    });
    expect(
      resolveAflTradeGateEligibility(automatedLedger, {
        gate: 'gate_3_model_validity',
        decisionKey: automatedProposal.content.decisionKey,
        environment: 'non_production',
        evaluatedAt: '2036-08-21T09:00:00.000Z',
      }).status
    ).toBe('mechanically_eligible');

    for (const invalidContent of [
      { ...decisionContent, environment: 'production' as const },
      { ...decisionContent, gate: 'gate_4_publication_api_readiness' as const },
      { ...decisionContent, revalidateAt: '2027-08-21T09:00:00.000Z' },
      { ...decisionContent, state: 'rejected' as const },
    ]) {
      expect(
        aflTradeGateDecisionRecordSchema.safeParse({
          decisionId: createAflTradeContentAddress('gate-decision', invalidContent),
          content: invalidContent,
        }).success
      ).toBe(false);
    }
  });

  it('preserves ordered decision-record issues when lifecycle rules fail together', () => {
    const decided = decision(proposal());
    const content = {
      ...decided.content,
      environment: 'production' as const,
      reviewers: [decided.content.reviewers[0], decided.content.reviewers[0]],
      conditionResults: [decided.content.conditionResults[0], decided.content.conditionResults[0]],
      decidedAt: '2026-08-01T03:00:00.000Z',
      effectiveAt: '2026-08-01T02:00:00.000Z',
      revalidateAt: '2026-08-01T02:00:00.000Z',
    };
    const result = aflTradeGateDecisionRecordContentSchema.safeParse(content);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected the composite decision fixture to be invalid.');
    expect(result.error.issues.map(({ code, path, message }) => ({ code, path, message }))).toEqual(
      [
        {
          code: 'custom',
          path: ['conditionResults'],
          message: 'Decision condition results must be unique.',
        },
        {
          code: 'custom',
          path: ['reviewers'],
          message: 'Decision reviewers must be unique.',
        },
        {
          code: 'custom',
          path: ['effectiveAt'],
          message: 'A decision cannot become effective before it is recorded.',
        },
        {
          code: 'custom',
          path: ['revalidateAt'],
          message: 'Revalidation must follow the effective time.',
        },
        {
          code: 'custom',
          path: ['authorityKind'],
          message: 'Production approval requires an externally recorded human decision.',
        },
      ]
    );
  });

  it('fails closed when a required condition is unsatisfied', () => {
    const proposed = proposal();
    const result = validateAflTradeGateDecisionLedger(
      ledger([proposed], [decision(proposed, { conditionStatus: 'unsatisfied' })])
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'required_condition_unsatisfied' })
    );
  });

  it('requires the declared independent reviewer role and identity', () => {
    const proposed = proposal();
    const result = validateAflTradeGateDecisionLedger(
      ledger([proposed], [decision(proposed, { reviewerId: 'fixture-data-owner' })])
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'review_requirement_unsatisfied' })
    );
  });

  it('derives expiry from the revalidation cutoff without rewriting the decision', () => {
    const proposed = proposal();
    const decided = decision(proposed, { revalidateAt: '2026-08-04T00:00:00.000Z' });
    const resolution = resolveAflTradeGateEligibility(ledger([proposed], [decided]), {
      gate: proposed.content.gate,
      decisionKey: proposed.content.decisionKey,
      environment: 'test_fixture',
      evaluatedAt: '2026-08-04T00:00:00.000Z',
    });

    expect(resolution.status).toBe('blocked');
    expect(resolution.blockers).toContainEqual(
      expect.objectContaining({ code: 'decision_expired' })
    );
    expect(decided.content.state).toBe('approved');
  });

  it('distinguishes an invalid eligibility request from decision timing', () => {
    const proposed = proposal();
    const decided = decision(proposed);
    expect(
      resolveAflTradeGateEligibility(ledger([proposed], [decided]), {
        gate: proposed.content.gate,
        decisionKey: proposed.content.decisionKey,
        environment: 'test_fixture',
        evaluatedAt: 'not-an-instant',
      }).blockers
    ).toEqual([expect.objectContaining({ code: 'invalid_request' })]);
  });

  it('reports whether append failed because the ledger or candidate was invalid', () => {
    const proposed = proposal();
    const decided = decision(proposed);
    const invalidLedger = ledger([proposed], [
      { ...decided, content: { ...decided.content, state: 'blocked' } },
    ] as AflTradeGateDecisionRecord[]);

    expect(() => appendAflTradeGateDecision(invalidLedger, proposed, decided)).toThrowError(
      expect.objectContaining({ code: 'INVALID_LEDGER' })
    );

    const decisionForAnotherProposal = decision(proposal(2));
    expect(() =>
      appendAflTradeGateDecision(ledger([], []), proposed, decisionForAnotherProposal)
    ).toThrowError(expect.objectContaining({ code: 'INVALID_APPEND' }));
  });

  it('keeps a prior effective approval while a later proposal remains pending', () => {
    const firstProposal = proposal(1);
    const firstDecision = decision(firstProposal);
    const pendingProposal = proposal(2);
    const pendingDecision = decision(pendingProposal, {
      state: 'pending',
      supersedesDecisionId: firstDecision.decisionId,
    });
    const resolution = resolveAflTradeGateEligibility(
      ledger([firstProposal, pendingProposal], [firstDecision, pendingDecision]),
      {
        gate: firstProposal.content.gate,
        decisionKey: firstProposal.content.decisionKey,
        environment: 'test_fixture',
        evaluatedAt: '2026-08-04T00:00:00.000Z',
      }
    );

    expect(resolution.status).toBe('mechanically_eligible');
    expect(resolution.decision?.decisionId).toBe(firstDecision.decisionId);
  });

  it('blocks after a linear withdrawal supersedes an approval', () => {
    const firstProposal = proposal(1);
    const firstDecision = decision(firstProposal);
    const withdrawalProposal = proposal(2);
    const withdrawal = decision(withdrawalProposal, {
      state: 'withdrawn',
      supersedesDecisionId: firstDecision.decisionId,
    });
    const fixtureLedger = ledger([firstProposal, withdrawalProposal], [firstDecision, withdrawal]);

    expect(validateAflTradeGateDecisionLedger(fixtureLedger).valid).toBe(true);
    expect(
      resolveAflTradeGateEligibility(fixtureLedger, {
        gate: firstProposal.content.gate,
        decisionKey: firstProposal.content.decisionKey,
        environment: 'test_fixture',
        evaluatedAt: '2026-08-04T00:00:00.000Z',
      }).blockers
    ).toContainEqual(expect.objectContaining({ code: 'decision_withdrawn' }));
  });

  it('rejects a supersession fork and missing proposal references', () => {
    const firstProposal = proposal(1);
    const firstDecision = decision(firstProposal);
    const secondProposal = proposal(2);
    const firstSuccessor = decision(secondProposal, {
      supersedesDecisionId: firstDecision.decisionId,
    });
    const alternativeContent = {
      ...firstSuccessor.content,
      rationale: 'A second fabricated successor creates an invalid fork.',
    };
    const secondSuccessor = aflTradeGateDecisionRecordSchema.parse({
      decisionId: createAflTradeContentAddress('gate-decision', alternativeContent),
      content: alternativeContent,
    });
    const fork = validateAflTradeGateDecisionLedger(
      ledger([firstProposal, secondProposal], [firstDecision, firstSuccessor, secondSuccessor])
    );
    expect(fork.valid).toBe(false);
    expect(fork.issues).toContainEqual(expect.objectContaining({ code: 'supersession_fork' }));

    const missingProposal = validateAflTradeGateDecisionLedger(ledger([], [firstDecision]));
    expect(missingProposal.issues).toContainEqual(
      expect.objectContaining({ code: 'missing_proposal' })
    );
  });
});
