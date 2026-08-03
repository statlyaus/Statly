import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeDecisionEnvironment,
  type AflTradeGateCode,
  type AflTradeGateDecisionProposal,
  type AflTradeGateDecisionRecord,
} from './gateDecisionTypes';

export interface AflTradeGateDecisionLedger {
  proposals: readonly AflTradeGateDecisionProposal[];
  decisions: readonly AflTradeGateDecisionRecord[];
}

export type AflTradeGateLedgerIssueCode =
  | 'invalid_proposal'
  | 'invalid_decision'
  | 'duplicate_proposal'
  | 'duplicate_decision'
  | 'duplicate_version'
  | 'missing_proposal'
  | 'proposal_mismatch'
  | 'condition_mismatch'
  | 'required_condition_unsatisfied'
  | 'review_requirement_unsatisfied'
  | 'invalid_fixture_authority'
  | 'invalid_supersession'
  | 'supersession_fork'
  | 'non_monotonic_decision';

export interface AflTradeGateLedgerIssue {
  code: AflTradeGateLedgerIssueCode;
  subjectId: string;
  message: string;
}

export interface AflTradeGateLedgerValidation {
  valid: boolean;
  issues: AflTradeGateLedgerIssue[];
}

export type AflTradeGateEligibilityBlockerCode =
  | 'invalid_ledger'
  | 'invalid_request'
  | 'decision_absent'
  | 'decision_not_effective'
  | 'decision_pending'
  | 'decision_blocked'
  | 'decision_expired'
  | 'decision_withdrawn'
  | 'environment_mismatch';

export interface AflTradeGateEligibilityBlocker {
  code: AflTradeGateEligibilityBlockerCode;
  message: string;
}

export interface AflTradeGateEligibilityResolution {
  status: 'mechanically_eligible' | 'blocked';
  decision: AflTradeGateDecisionRecord | null;
  blockers: AflTradeGateEligibilityBlocker[];
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function versionKey(value: {
  content: {
    gate: AflTradeGateCode;
    decisionKey: string;
    version: number;
    environment: AflTradeDecisionEnvironment;
  };
}): string {
  return [
    value.content.gate,
    value.content.environment,
    value.content.decisionKey,
    value.content.version,
  ].join('|');
}

function addIssue(
  issues: AflTradeGateLedgerIssue[],
  code: AflTradeGateLedgerIssueCode,
  subjectId: string,
  message: string
) {
  issues.push({ code, subjectId, message });
}

export class AflTradeGateDecisionAppendError extends Error {
  constructor(
    public readonly code: 'INVALID_LEDGER' | 'INVALID_APPEND',
    public readonly issues: readonly AflTradeGateLedgerIssue[]
  ) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'AflTradeGateDecisionAppendError';
  }
}

function invalidEntrySubject(
  value: unknown,
  idKey: 'proposalId' | 'decisionId',
  fallback: string
): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const id = (value as Record<string, unknown>)[idKey];
  return typeof id === 'string' ? id : fallback;
}

function parseGateProposal(
  proposal: unknown,
  index: number,
  issues: AflTradeGateLedgerIssue[]
): AflTradeGateDecisionProposal[] {
  const parsed = aflTradeGateDecisionProposalSchema.safeParse(proposal);
  if (parsed.success) return [parsed.data];
  addIssue(
    issues,
    'invalid_proposal',
    invalidEntrySubject(proposal, 'proposalId', `proposal[${index}]`),
    `Proposal at index ${index} is not a valid content-addressed gate proposal.`
  );
  return [];
}

function parseGateDecision(
  decision: unknown,
  index: number,
  issues: AflTradeGateLedgerIssue[]
): AflTradeGateDecisionRecord[] {
  const parsed = aflTradeGateDecisionRecordSchema.safeParse(decision);
  if (parsed.success) return [parsed.data];
  addIssue(
    issues,
    'invalid_decision',
    invalidEntrySubject(decision, 'decisionId', `decision[${index}]`),
    `Decision at index ${index} is not a valid content-addressed gate decision.`
  );
  return [];
}

function parseGateLedger(ledger: AflTradeGateDecisionLedger): {
  proposals: AflTradeGateDecisionProposal[];
  decisions: AflTradeGateDecisionRecord[];
  issues: AflTradeGateLedgerIssue[];
} {
  const issues: AflTradeGateLedgerIssue[] = [];
  const proposalEntries = Array.isArray(ledger?.proposals) ? ledger.proposals : [];
  const decisionEntries = Array.isArray(ledger?.decisions) ? ledger.decisions : [];
  const proposals = proposalEntries.flatMap((proposal, index) =>
    parseGateProposal(proposal, index, issues)
  );
  const decisions = decisionEntries.flatMap((decision, index) =>
    parseGateDecision(decision, index, issues)
  );
  if (!Array.isArray(ledger?.proposals)) {
    addIssue(issues, 'invalid_proposal', 'proposals', 'Ledger proposals must be an array.');
  }
  if (!Array.isArray(ledger?.decisions)) {
    addIssue(issues, 'invalid_decision', 'decisions', 'Ledger decisions must be an array.');
  }
  return { proposals, decisions, issues };
}

function collectDuplicateGateLedgerIssues(
  proposals: readonly AflTradeGateDecisionProposal[],
  decisions: readonly AflTradeGateDecisionRecord[]
): AflTradeGateLedgerIssue[] {
  const issues: AflTradeGateLedgerIssue[] = [];
  for (const proposalId of duplicateValues(proposals.map((item) => item.proposalId))) {
    addIssue(issues, 'duplicate_proposal', proposalId, `Proposal ${proposalId} is duplicated.`);
  }
  for (const decisionId of duplicateValues(decisions.map((item) => item.decisionId))) {
    addIssue(issues, 'duplicate_decision', decisionId, `Decision ${decisionId} is duplicated.`);
  }
  for (const key of duplicateValues(proposals.map(versionKey))) {
    addIssue(issues, 'duplicate_version', key, `Proposal version ${key} is duplicated.`);
  }
  for (const key of duplicateValues(decisions.map(versionKey))) {
    addIssue(issues, 'duplicate_version', key, `Decision version ${key} is duplicated.`);
  }
  return issues;
}

function sameProposalDecisionIdentity(
  proposal: AflTradeGateDecisionProposal,
  decision: AflTradeGateDecisionRecord
): boolean {
  const proposalIdentity = {
    gate: proposal.content.gate,
    decisionKey: proposal.content.decisionKey,
    version: proposal.content.version,
    environment: proposal.content.environment,
    scope: proposal.content.scope,
    accountableOwner: proposal.content.accountableOwner,
  };
  const decisionIdentity = {
    gate: decision.content.gate,
    decisionKey: decision.content.decisionKey,
    version: decision.content.version,
    environment: decision.content.environment,
    scope: decision.content.scope,
    accountableOwner: decision.content.accountableOwner,
  };
  return canonicalizeAflTradeJson(proposalIdentity) === canonicalizeAflTradeJson(decisionIdentity);
}

function collectDecisionProposalIssues(
  proposal: AflTradeGateDecisionProposal,
  decision: AflTradeGateDecisionRecord
): AflTradeGateLedgerIssue[] {
  const issues: AflTradeGateLedgerIssue[] = [];
  if (!sameProposalDecisionIdentity(proposal, decision)) {
    addIssue(
      issues,
      'proposal_mismatch',
      decision.decisionId,
      `Decision ${decision.decisionId} does not match its proposal identity and scope.`
    );
  }

  const proposedConditions = new Map(
    proposal.content.conditions.map((condition) => [condition.conditionId, condition])
  );
  const decidedConditions = new Map(
    decision.content.conditionResults.map((condition) => [condition.conditionId, condition])
  );
  const conditionMismatch =
    proposedConditions.size !== decidedConditions.size ||
    [...proposedConditions.keys()].some((conditionId) => !decidedConditions.has(conditionId));
  if (conditionMismatch) {
    addIssue(
      issues,
      'condition_mismatch',
      decision.decisionId,
      `Decision ${decision.decisionId} must resolve every and only proposed condition.`
    );
  }
  if (decision.content.state === 'approved') {
    for (const condition of proposedConditions.values()) {
      if (
        condition.required &&
        decidedConditions.get(condition.conditionId)?.status !== 'satisfied'
      ) {
        addIssue(
          issues,
          'required_condition_unsatisfied',
          decision.decisionId,
          `Required condition ${condition.conditionId} is not satisfied.`
        );
      }
    }
  }

  if (
    decision.content.state === 'approved' &&
    proposal.content.reviewRequirement === 'independent_review_required'
  ) {
    const independentReviewers = decision.content.reviewers.filter(
      (reviewer) =>
        reviewer.reviewerId !== decision.content.decidedBy &&
        reviewer.reviewerId !== proposal.content.accountableOwner
    );
    const coveredRoles = new Set(independentReviewers.map((reviewer) => reviewer.role));
    if (
      proposal.content.requiredReviewerRoles.some((role) => !coveredRoles.has(role)) ||
      independentReviewers.length === 0
    ) {
      addIssue(
        issues,
        'review_requirement_unsatisfied',
        decision.decisionId,
        `Decision ${decision.decisionId} lacks the required independent review.`
      );
    }
  }

  if (
    decision.content.authorityKind === 'fixture' &&
    decision.content.environment !== 'test_fixture'
  ) {
    addIssue(
      issues,
      'invalid_fixture_authority',
      decision.decisionId,
      'Fixture authority is valid only in the test-fixture environment.'
    );
  }
  return issues;
}

function isDirectPredecessor(
  predecessor: AflTradeGateDecisionRecord | undefined,
  decision: AflTradeGateDecisionRecord
): predecessor is AflTradeGateDecisionRecord {
  return (
    predecessor !== undefined &&
    predecessor.content.gate === decision.content.gate &&
    predecessor.content.environment === decision.content.environment &&
    predecessor.content.decisionKey === decision.content.decisionKey &&
    predecessor.content.version === decision.content.version - 1
  );
}

function collectDecisionSupersessionIssues(
  decision: AflTradeGateDecisionRecord,
  decisionById: ReadonlyMap<string, AflTradeGateDecisionRecord>,
  successorsByDecisionId: Map<string, string[]>
): AflTradeGateLedgerIssue[] {
  const issues: AflTradeGateLedgerIssue[] = [];
  const supersededId = decision.content.supersedesDecisionId;
  if (decision.content.version === 1) {
    if (supersededId !== null) {
      addIssue(
        issues,
        'invalid_supersession',
        decision.decisionId,
        'The first decision version cannot supersede another decision.'
      );
    }
    return issues;
  }
  const superseded = supersededId ? decisionById.get(supersededId) : undefined;
  if (!isDirectPredecessor(superseded, decision)) {
    addIssue(
      issues,
      'invalid_supersession',
      decision.decisionId,
      `Decision version ${decision.content.version} must supersede version ${decision.content.version - 1}.`
    );
    return issues;
  }
  const successors = successorsByDecisionId.get(superseded.decisionId) ?? [];
  successors.push(decision.decisionId);
  successorsByDecisionId.set(superseded.decisionId, successors);
  if (
    decision.content.decidedAt !== null &&
    superseded.content.decidedAt !== null &&
    Date.parse(decision.content.decidedAt) < Date.parse(superseded.content.decidedAt)
  ) {
    addIssue(
      issues,
      'non_monotonic_decision',
      decision.decisionId,
      'Decision versions must be recorded chronologically.'
    );
  }
  return issues;
}

function collectSupersessionForkIssues(
  successorsByDecisionId: ReadonlyMap<string, readonly string[]>
): AflTradeGateLedgerIssue[] {
  const issues: AflTradeGateLedgerIssue[] = [];
  for (const [decisionId, successors] of successorsByDecisionId) {
    if (successors.length > 1) {
      addIssue(
        issues,
        'supersession_fork',
        decisionId,
        `Decision ${decisionId} has more than one direct successor.`
      );
    }
  }
  return issues;
}

export function validateAflTradeGateDecisionLedger(
  ledger: AflTradeGateDecisionLedger
): AflTradeGateLedgerValidation {
  const { proposals, decisions, issues } = parseGateLedger(ledger);
  issues.push(...collectDuplicateGateLedgerIssues(proposals, decisions));
  const proposalById = new Map(proposals.map((proposal) => [proposal.proposalId, proposal]));
  const decisionById = new Map(decisions.map((decision) => [decision.decisionId, decision]));
  const successorsByDecisionId = new Map<string, string[]>();
  for (const decision of decisions) {
    const proposal = proposalById.get(decision.content.proposalId);
    if (!proposal) {
      addIssue(
        issues,
        'missing_proposal',
        decision.decisionId,
        `Decision ${decision.decisionId} references a missing proposal.`
      );
      continue;
    }
    issues.push(...collectDecisionProposalIssues(proposal, decision));
    issues.push(...collectDecisionSupersessionIssues(decision, decisionById, successorsByDecisionId));
  }
  issues.push(...collectSupersessionForkIssues(successorsByDecisionId));
  return { valid: issues.length === 0, issues };
}

export function appendAflTradeGateDecision(
  ledger: AflTradeGateDecisionLedger,
  proposal: AflTradeGateDecisionProposal,
  decision: AflTradeGateDecisionRecord
): AflTradeGateDecisionLedger {
  const existingValidation = validateAflTradeGateDecisionLedger(ledger);
  if (!existingValidation.valid) {
    throw new AflTradeGateDecisionAppendError('INVALID_LEDGER', existingValidation.issues);
  }
  const candidate = {
    proposals: [...ledger.proposals, proposal],
    decisions: [...ledger.decisions, decision],
  };
  const validation = validateAflTradeGateDecisionLedger(candidate);
  if (!validation.valid) {
    throw new AflTradeGateDecisionAppendError('INVALID_APPEND', validation.issues);
  }
  return candidate;
}

export function resolveAflTradeGateEligibility(
  ledger: AflTradeGateDecisionLedger,
  request: {
    gate: AflTradeGateCode;
    decisionKey: string;
    environment: AflTradeDecisionEnvironment;
    evaluatedAt: string;
  }
): AflTradeGateEligibilityResolution {
  const validation = validateAflTradeGateDecisionLedger(ledger);
  if (!validation.valid) {
    return {
      status: 'blocked',
      decision: null,
      blockers: [{ code: 'invalid_ledger', message: 'The decision ledger is invalid.' }],
    };
  }
  const evaluatedAt = Date.parse(request.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) {
    return {
      status: 'blocked',
      decision: null,
      blockers: [{ code: 'invalid_request', message: 'The evaluation time is invalid.' }],
    };
  }

  const matchingEnvironment = ledger.decisions.filter(
    (decision) =>
      decision.content.gate === request.gate &&
      decision.content.decisionKey === request.decisionKey &&
      decision.content.environment === request.environment
  );
  const candidates = matchingEnvironment
    .filter(
      (decision) =>
        decision.content.effectiveAt !== null &&
        Date.parse(decision.content.effectiveAt) <= evaluatedAt
    )
    .sort((left, right) => right.content.version - left.content.version);

  const decision = candidates[0] ?? null;
  if (!decision) {
    const latestMatching = [...matchingEnvironment].sort(
      (left, right) => right.content.version - left.content.version
    )[0];
    if (latestMatching?.content.state === 'pending') {
      return {
        status: 'blocked',
        decision: latestMatching,
        blockers: [{ code: 'decision_pending', message: 'The gate decision is pending.' }],
      };
    }
    if (latestMatching) {
      return {
        status: 'blocked',
        decision: latestMatching,
        blockers: [
          { code: 'decision_not_effective', message: 'The gate decision is not yet effective.' },
        ],
      };
    }
    const wrongEnvironment = ledger.decisions.some(
      (candidate) =>
        candidate.content.gate === request.gate &&
        candidate.content.decisionKey === request.decisionKey &&
        candidate.content.environment !== request.environment
    );
    return {
      status: 'blocked',
      decision: null,
      blockers: [
        wrongEnvironment
          ? {
              code: 'environment_mismatch',
              message: 'A decision exists only for a different environment.',
            }
          : { code: 'decision_absent', message: 'No effective gate decision exists.' },
      ],
    };
  }

  if (decision.content.state !== 'approved') {
    const stateBlockers: Record<
      Exclude<AflTradeGateDecisionRecord['content']['state'], 'approved'>,
      AflTradeGateEligibilityBlocker
    > = {
      pending: { code: 'decision_pending', message: 'The gate decision is pending.' },
      blocked: { code: 'decision_blocked', message: 'The gate decision is blocked.' },
      expired: { code: 'decision_expired', message: 'The gate decision is expired.' },
      withdrawn: { code: 'decision_withdrawn', message: 'The gate decision is withdrawn.' },
    };
    return { status: 'blocked', decision, blockers: [stateBlockers[decision.content.state]] };
  }

  if (
    decision.content.revalidateAt === null ||
    Date.parse(decision.content.revalidateAt) <= evaluatedAt
  ) {
    return {
      status: 'blocked',
      decision,
      blockers: [{ code: 'decision_expired', message: 'The approval requires revalidation.' }],
    };
  }

  return { status: 'mechanically_eligible', decision, blockers: [] };
}
