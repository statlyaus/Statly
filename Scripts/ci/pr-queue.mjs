#!/usr/bin/env node

// Pull request queue. The Main ruleset requires branches to be up to date with main, and a
// personal-account repository has no merge queue, so a green auto-merge pull request sits BEHIND
// until someone runs `gh pr update-branch`. This does it for one pull request at a time: when no
// auto-merge pull request is already running CI or about to merge, it updates the oldest green
// BEHIND one. One CI run per main move, never one per open pull request.
//
// It updates branches only with QUEUE_TOKEN, the owner's fine-grained token. An update made with
// GITHUB_TOKEN commits as github-actions[bot]: GitHub then holds the pull request's own CI run for
// approval, and a dispatched run's CI Gate is not attached to the pull request, so the required
// check never appears and the queue waits on it forever (#1237, 8 Nov 2026). With the owner token
// the update triggers the pull request's CI like any push. On the schedule it also dispatches CI for
// a main tip that no CI run covers. See "Pull request queue" in docs/development/delivery.md.
//
//   GH_TOKEN=... GITHUB_REPOSITORY=owner/name node Scripts/ci/pr-queue.mjs

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NO_CHECKS_GRACE_MS = 10 * 60 * 1000;
const RUNNING = new Set(['PENDING', 'EXPECTED']);
const MERGEABLE = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE']);

/**
 * Decide the queue's next step. `checks` is the head commit's check rollup state, or null when no
 * CI workflow run has reported on the head commit.
 */
export function planQueue(prs, now = Date.now()) {
  const queued = prs
    .filter((pr) => !pr.isDraft && pr.autoMerge && pr.sameRepository)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  for (const pr of queued) {
    if (
      pr.mergeStateStatus === 'BEHIND' ||
      pr.mergeStateStatus === 'UNKNOWN' ||
      pr.mergeStateStatus === 'DIRTY'
    ) {
      continue;
    }
    if (pr.checks === null) {
      const age = now - Date.parse(pr.headCommittedAt);
      if (age >= NO_CHECKS_GRACE_MS)
        return { action: 'dispatch', number: pr.number, headRefName: pr.headRefName };
      return { action: 'wait', number: pr.number };
    }
    if (RUNNING.has(pr.checks)) return { action: 'wait', number: pr.number };
    if (pr.checks === 'SUCCESS' && MERGEABLE.has(pr.mergeStateStatus))
      return { action: 'wait', number: pr.number };
    // Failed checks, or green but blocked by something CI cannot fix (an unresolved review thread).
  }

  const candidates = queued
    .filter((pr) => pr.mergeStateStatus === 'BEHIND' && pr.checks === 'SUCCESS')
    .map((pr) => pr.number);
  return candidates.length > 0 ? { action: 'update', candidates } : { action: 'none' };
}

function gh(args, { allowFailure = false } = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`gh ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

const QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, baseRefName: "main", first: 50) {
      nodes {
        number createdAt isDraft isCrossRepository mergeStateStatus headRefName
        autoMergeRequest { enabledAt }
        commits(last: 1) { nodes { commit {
          oid committedDate
          statusCheckRollup { state contexts(first: 100) { nodes {
            ... on CheckRun { checkSuite { workflowRun { workflow { name } } } }
          } } }
        } } }
      }
    }
  }
}`;

export function loadPullRequests(repo) {
  const [owner, name] = repo.split('/');
  const { stdout } = gh([
    'api',
    'graphql',
    '-f',
    `query=${QUERY}`,
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
  ]);
  return JSON.parse(stdout).data.repository.pullRequests.nodes.map((node) => {
    const commit = node.commits.nodes[0]?.commit;
    const rollup = commit?.statusCheckRollup;
    // CI Gate itself appears only when every job has finished, so look for any job of the CI workflow.
    const hasCi =
      rollup?.contexts.nodes.some(
        (check) => check.checkSuite?.workflowRun?.workflow?.name === 'CI'
      ) ?? false;
    return {
      number: node.number,
      createdAt: node.createdAt,
      isDraft: node.isDraft,
      autoMerge: node.autoMergeRequest !== null,
      sameRepository: !node.isCrossRepository,
      mergeStateStatus: node.mergeStateStatus,
      checks: hasCi ? rollup.state : null,
      headRefName: node.headRefName,
      headOid: commit?.oid,
      headCommittedAt: commit?.committedDate,
    };
  });
}

/** True when the workflow runs with QUEUE_TOKEN, the only token whose branch updates get CI. */
export function canUpdateBranches(env = process.env) {
  return env.QUEUE_TOKEN_SET === 'true';
}

function dispatchCi(repo, ref) {
  gh(['workflow', 'run', 'ci.yml', '--repo', repo, '--ref', ref]);
  console.log(`Dispatched CI on ${ref}.`);
}

function headSha(repo, number) {
  return gh(['api', `repos/${repo}/pulls/${number}`, '--jq', '.head.sha']).stdout;
}

async function updateOldest(repo, prs, candidates) {
  for (const number of candidates) {
    const pr = prs.find((item) => item.number === number);
    const update = gh(
      [
        'api',
        '-X',
        'PUT',
        `repos/${repo}/pulls/${number}/update-branch`,
        '-f',
        `expected_head_sha=${pr.headOid}`,
      ],
      { allowFailure: true }
    );
    if (!update.ok) {
      // For example a merge that would change .github/workflows, which GITHUB_TOKEN may not push.
      console.log(`Could not update #${number}: ${update.stderr}. Trying the next one.`);
      continue;
    }
    let moved = false;
    for (let attempt = 0; attempt < 24 && !moved; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      moved = headSha(repo, number) !== pr.headOid;
    }
    if (!moved) {
      // The pull request's CI starts once GitHub registers the new head.
      console.log(
        `Updated #${number}, but its head has not moved yet; CI is left to the next run.`
      );
      return;
    }
    // The owner-token push triggers the pull request's own CI; no dispatch needed.
    console.log(`Updated #${number} with main.`);
    return;
  }
  console.log('No BEHIND pull request could be updated.');
}

function verifyMain(repo, now) {
  const [sha, committedAt] = gh([
    'api',
    `repos/${repo}/commits/main`,
    '--jq',
    '.sha + " " + .commit.committer.date',
  ]).stdout.split(' ');
  if (now - Date.parse(committedAt) < NO_CHECKS_GRACE_MS) return;
  const runs = gh([
    'api',
    `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=1`,
    '--jq',
    '.total_count',
  ]);
  if (runs.stdout === '0') {
    console.log(`main ${sha} has no CI run.`);
    dispatchCi(repo, 'main');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is required.');
  const now = Date.now();
  const prs = loadPullRequests(repo);
  const plan = planQueue(prs, now);
  console.log(`Plan: ${JSON.stringify(plan)}`);
  if (plan.action === 'update') {
    if (canUpdateBranches()) await updateOldest(repo, prs, plan.candidates);
    else
      console.log(
        'QUEUE_TOKEN is not set, so no branch is updated: a GITHUB_TOKEN update leaves the pull request CI awaiting approval. Update by hand with `gh pr update-branch`.'
      );
  }
  if (plan.action === 'dispatch') dispatchCi(repo, plan.headRefName);
  if (process.env.GITHUB_EVENT_NAME === 'schedule') verifyMain(repo, now);
}
