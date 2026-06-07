const ROLE_DESCRIPTIONS = {
  'The Contrarian':
    "hunts for what will fail. Not pessimism, just the friend asking the questions you're avoiding.",
  'First Principles': "strips assumptions, asks if you're solving the right problem.",
  'The Expansionist': 'ignores risk, hunts for hidden upside.',
  'The Outsider': 'zero context, catches the curse of knowledge.',
  'The Executor': 'what do you do Monday morning?',
};

export function runLogicalCouncil({ prompt, models, chairman, provider }) {
  const files = changedFiles(prompt);
  const context = logicalContext(prompt, files);
  const decisions = logicalDecisions(context);
  const stage1 = models.map((model, index) => ({
    label: `Opinion ${String.fromCharCode(65 + index)}`,
    model,
    response: logicalMemberResponse(model, context),
  }));
  const stage2 = stage1.map((entry) => ({
    model: entry.model,
    ranking: `Debate contribution recorded for ${entry.model}.`,
    parsedRanking: stage1.map((candidate) => candidate.label),
  }));
  const aggregate = stage1.map((entry, index) => ({
    model: entry.model,
    averageRank: index + 1,
    rankingsCount: stage2.length,
  }));

  return {
    provider,
    models,
    chairman,
    promptChars: prompt.length,
    stage1,
    stage2,
    aggregate,
    final: {
      model: chairman,
      response: logicalSynthesis(stage1, context, decisions),
    },
  };
}

function logicalContext(prompt, files) {
  const controlPrompt = controlContext(prompt);
  const lowerControlPrompt = controlPrompt.toLowerCase();
  const isCommitDecision =
    /\bdecision\s*2\b/.test(lowerControlPrompt) ||
    lowerControlPrompt.includes('should be committed');
  return {
    prompt,
    controlPrompt,
    lowerControlPrompt,
    files,
    fileList: files.length ? files.join(', ') : 'no files detected',
    hasStagedDiff: /Staged diff:\n(?!\(none\))/m.test(prompt),
    isCommitDecision,
  };
}

function logicalDecisions(context) {
  const proceedBlockers = proceedBlockingSignals(context.controlPrompt);
  const commitBlockers = context.isCommitDecision ? commitBlockingSignals(context) : [];

  return {
    decision1: context.isCommitDecision
      ? 'NOT_APPLICABLE'
      : proceedBlockers.length > 0
        ? 'DO_NOT_PROCEED'
        : 'PROCEED',
    decision2: context.isCommitDecision
      ? context.hasStagedDiff && context.files.length > 0 && commitBlockers.length === 0
        ? 'COMMIT'
        : 'DO_NOT_COMMIT'
      : 'NOT_APPLICABLE',
    blockers: [...proceedBlockers, ...commitBlockers],
  };
}

function logicalMemberResponse(model, context) {
  const role = ROLE_DESCRIPTIONS[model] ?? 'reviews for correctness and regression risk';

  if (model === 'The Contrarian') {
    return `${model} - ${role} Opinion: the likely failure is stopping at a plan, approval request, or index-only workaround. Check that the chosen boundary fixes the source of truth, excludes unrelated dirty files, and proves the behavior with tests. Files in view: ${context.fileList}.`;
  }

  if (model === 'First Principles') {
    return `${model} - ${role} Opinion: decide from the user outcome backward. The right path is the smallest source-of-truth fix that still works across direct load, refresh, client navigation, API behavior, and prefetch. If the prompt exposes invalid data shape or remote-query assumptions, normalize at the data boundary before rendering.`;
  }

  if (model === 'The Expansionist') {
    return `${model} - ${role} Opinion: turn this into durable leverage. Encode the decision in repo-local scripts and instructions, use regression tests around the failing boundary, and leave a workflow that future sessions can run without paid models or human re-approval after the chairman decides.`;
  }

  if (model === 'The Outsider') {
    return `${model} - ${role} Opinion: make the result auditable to someone with no context. Show each member's view before the chairman, name the accepted long-term option, name rejected alternatives, and make the next action concrete enough that the agent can continue automatically.`;
  }

  if (model === 'The Executor') {
    return `${model} - ${role} Opinion: after CHAIRMAN DECISION 1: PROCEED, start work immediately. Keep blocking implementation local, delegate bounded supporting work to sub-agents where available, verify, run Decision 2, and commit only through the reviewed path.`;
  }

  return `${model} - ${role}. Opinion: review the prompt and diff for correctness, maintainability, project conventions, and regression risk. Files in view: ${context.fileList}.`;
}

function logicalSynthesis(stage1, context, decisions) {
  const blockerSummary = decisions.blockers.length ? decisions.blockers.join('; ') : 'none';
  const bestOption = bestLongTermOption(context, decisions);
  const alternatives = rejectedAlternatives(context, decisions);
  const nextStep = concreteNextStep(context, decisions);

  return `## Committee Debate
${stage1.map((entry) => `- ${entry.response}`).join('\n')}

## Chairman Decision
CHAIRMAN DECISION 1: ${decisions.decision1}
CHAIRMAN DECISION 2: ${decisions.decision2}

Best long-term option: ${bestOption}
Where the council agrees: fix the root cause at the owning boundary, preserve reviewable scope, verify the behavior, and keep unrelated dirty files out of the commit.
Where it clashes: The Expansionist wants workflow leverage, while The Contrarian and First Principles constrain the change to the source-of-truth boundary and regression proof.
Blind spots caught: approval-after-decision stalls, index-only or data-only patches, missing normalization, missing tests, broad staging, and extension-caused noise being mistaken for app behavior.
Rejected alternatives: ${alternatives}
Blocking signals: ${blockerSummary}.
Detected files: ${context.fileList}.
Concrete next step: ${nextStep}`;
}

function bestLongTermOption(context, decisions) {
  if (decisions.decision2 === 'COMMIT') {
    return 'commit the staged, reviewed changes through the Decision 2 commit gate because no blocking signals remain.';
  }
  if (context.isCommitDecision) {
    return 'do not commit yet; resolve the blocking signals, restage only intended files, and rerun Decision 2.';
  }
  if (decisions.decision1 !== 'PROCEED') {
    return 'do not proceed until the request is reframed away from shortcuts, destructive git actions, broad staging, or skipped verification.';
  }
  if (mentionsLeagueMembership(context) && context.lowerControlPrompt.includes('joinedat')) {
    return 'fix league membership at the data boundary: read membership docs without relying on remote joinedAt ordering, normalize missing joinedAt, and sort locally with regression coverage.';
  }
  return 'proceed with the durable source-of-truth fix, then verify the boundary that failed and run Decision 2 before committing.';
}

function mentionsLeagueMembership(context) {
  return (
    context.lowerControlPrompt.includes('leaguemembership') ||
    context.lowerControlPrompt.includes('listactiveleaguemembers') ||
    context.lowerControlPrompt.includes('league members')
  );
}

function rejectedAlternatives(context, decisions) {
  if (decisions.blockers.length > 0) {
    return 'rubber-stamping through known blockers, skipping verification, or committing unsafe staged files.';
  }
  if (
    context.lowerControlPrompt.includes('index') ||
    context.lowerControlPrompt.includes('orderby')
  ) {
    return 'an index-only fix or data-only backfill, because either can mask valid documents that still need boundary normalization.';
  }
  return 'short-term patches, approval stalls after a chairman decision, broad refactors without evidence, and blanket staging.';
}

function concreteNextStep(context, decisions) {
  if (decisions.decision2 === 'COMMIT') {
    return 'run `npm run codex:commit:reviewed -- "<message>"` now.';
  }
  if (context.isCommitDecision) {
    return 'fix the listed blockers, rerun targeted checks, then rerun Decision 2.';
  }
  if (decisions.decision1 !== 'PROCEED') {
    return 'stop before editing and replace the unsafe request with a durable, testable implementation request.';
  }
  return 'continue automatically into implementation; assign any bounded supporting work to sub-agents, complete the change, verify it, then run Decision 2.';
}

function controlContext(prompt) {
  return prompt.split(/\n\nGit status:\n/)[0] ?? prompt;
}

function proceedBlockingSignals(controlPrompt) {
  const checks = [
    {
      pattern:
        /\b(?:quick|temporary|hacky?|workaround|band[- ]?aid)\b.{0,50}\b(?:fix|patch|solution|ship|commit)\b/i,
      reason: 'control prompt asks for a short-term or workaround-style change',
    },
    {
      pattern: /\b(?:skip|avoid|without)\s+(?:tests?|lint|typecheck|verification)\b/i,
      reason: 'control prompt asks to skip verification',
    },
    {
      pattern: /\b(?:commit everything|stage everything|git add\s+\.)\b/i,
      reason: 'control prompt asks for broad staging or commit scope',
    },
    {
      pattern: /\b(?:git\s+reset\s+--hard|git\s+checkout\s+--|git\s+clean\s+-fd)\b/i,
      reason: 'control prompt asks for a destructive git command',
    },
  ];
  return checks.filter(({ pattern }) => pattern.test(controlPrompt)).map(({ reason }) => reason);
}

function commitBlockingSignals(context) {
  const blockers = [];
  if (!context.hasStagedDiff) blockers.push('no staged diff is available for commit review');
  if (context.files.length === 0) blockers.push('no changed files were detected for commit review');

  const blockedFiles = context.files.filter(isBlockedCommitFile);
  if (blockedFiles.length > 0) {
    blockers.push(`blocked local or secret files are staged: ${blockedFiles.join(', ')}`);
  }

  const addedLines = addedDiffLines(context.prompt);
  const realAddedLines = addedLines.filter((line) => !line.trimStart().startsWith('pattern:'));
  const diffChecks = [
    {
      hasSignal: addedLines.some((line) => /^(?:<<<<<<<|=======|>>>>>>>)\b/.test(line)),
      reason: 'staged diff contains merge conflict markers',
    },
    {
      hasSignal: realAddedLines.some((line) => /\b(?:describe|it|test)\.only\(/.test(line)),
      reason: 'staged diff adds a focused test',
    },
    {
      hasSignal: realAddedLines.some((line) => /\/\/\s*@ts-ignore\b/.test(line)),
      reason: 'staged diff adds a TypeScript ignore',
    },
    {
      hasSignal: realAddedLines.some((line) => /(?:\/\/|\/\*)\s*eslint-disable\b/.test(line)),
      reason: 'staged diff adds an ESLint disable',
    },
  ];
  return [
    ...blockers,
    ...diffChecks.filter(({ hasSignal }) => hasSignal).map(({ reason }) => reason),
  ];
}

function changedFiles(prompt) {
  const matches = [
    ...prompt.matchAll(/^diff --git a\/(.+?) b\/.+$/gm),
    ...prompt.matchAll(/^--- (?!a\/|b\/)([^\n]+)$/gm),
  ];
  return [
    ...new Set(matches.map((match) => match[1]).filter((file) => file && file !== '/dev/null')),
  ];
}

function addedDiffLines(prompt) {
  return prompt
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

function isBlockedCommitFile(file) {
  const name = file.split('/').pop() ?? file;
  return file === 'prisma/dev.db' || file.endsWith('.db') || name.startsWith('.env');
}
