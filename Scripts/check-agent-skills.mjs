import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.join(repoRoot, '.agents', 'skills');

const requiredUpstreamSkills = [
  'ask-matt',
  'code-review',
  'codebase-design',
  'diagnosing-bugs',
  'domain-modeling',
  'grill-with-docs',
  'grilling',
  'implement',
  'prototype',
  'research',
  'resolving-merge-conflicts',
  'setup-matt-pocock-skills',
  'tdd',
  'to-spec',
  'to-tickets',
].sort();

const explicitInvocationSkills = [
  'ask-matt',
  'grill-with-docs',
  'implement',
  'setup-matt-pocock-skills',
  'to-spec',
  'to-tickets',
];

const requiredWorkflowSkills = [
  'code-review',
  'codebase-design',
  'diagnosing-bugs',
  'docs-sweep-loop',
  'domain-modeling',
  'draft-reliability-loop',
  'grill-with-docs',
  'grilling',
  'product-design-review',
  'prototype',
  'tdd',
  'to-spec',
  'to-tickets',
];

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function exists(relativePath) {
  try {
    await access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function collectSkillFiles(baseDirectory, currentDirectory, files) {
  const entries = await readdir(currentDirectory, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') return;
        await collectSkillFiles(baseDirectory, fullPath, files);
      } else if (entry.isFile()) {
        files.push({
          content: await readFile(fullPath),
          relativePath: path.relative(baseDirectory, fullPath).split(path.sep).join('/'),
        });
      }
    })
  );
}

async function computeSkillFolderHash(skillDirectory) {
  const files = [];
  await collectSkillFiles(skillDirectory, skillDirectory, files);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }

  return hash.digest('hex');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseSkillFrontmatter(contents, relativePath) {
  const match = contents.match(/^---\n([\s\S]*?)\n---\n/);
  assert(match, `${relativePath} must start with YAML frontmatter`);

  const frontmatter = match[1];
  const name = frontmatter.match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1];
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1];

  assert(name, `${relativePath} must declare a non-empty name`);
  assert(description, `${relativePath} must declare a non-empty description`);

  return { frontmatter, name };
}

async function checkSkillDirectories() {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const names = new Set();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const relativePath = `.agents/skills/${entry.name}/SKILL.md`;
    const contents = await readRepoFile(relativePath);
    const { name } = parseSkillFrontmatter(contents, relativePath);

    assert(name === entry.name, `${relativePath} name must match its directory`);
    assert(!names.has(name), `Duplicate skill name: ${name}`);
    names.add(name);
  }

  assert(names.has('statly-engineering-workflow'), 'Statly engineering workflow skill is missing');
  return names.size;
}

async function checkLockfile() {
  const lockfile = JSON.parse(await readRepoFile('skills-lock.json'));
  assert(lockfile.version === 1, 'skills-lock.json must use version 1');

  const lockedNames = Object.keys(lockfile.skills ?? {}).sort();
  assert(
    JSON.stringify(lockedNames) === JSON.stringify(requiredUpstreamSkills),
    `skills-lock.json must contain only the approved upstream skills: ${requiredUpstreamSkills.join(', ')}`
  );

  for (const name of requiredUpstreamSkills) {
    const locked = lockfile.skills[name];
    assert(locked.source === 'mattpocock/skills', `${name} must be locked to mattpocock/skills`);
    assert(locked.sourceType === 'github', `${name} must use the GitHub source type`);
    assert(locked.skillPath?.endsWith(`/${name}/SKILL.md`), `${name} has an unexpected skill path`);
    assert(
      /^[a-f0-9]{64}$/.test(locked.computedHash ?? ''),
      `${name} must have a SHA-256 lock hash`
    );
    assert(await exists(`.agents/skills/${name}/SKILL.md`), `${name} is locked but not installed`);

    const installedHash = await computeSkillFolderHash(path.join(skillsRoot, name));
    assert(
      installedHash === locked.computedHash,
      `${name} differs from its locked upstream content; update the lock on a review branch`
    );
  }
}

async function checkInvocationPolicies() {
  for (const name of explicitInvocationSkills) {
    const contents = await readRepoFile(`.agents/skills/${name}/SKILL.md`);
    const { frontmatter } = parseSkillFrontmatter(contents, `${name}/SKILL.md`);
    assert(
      /^disable-model-invocation:\s*true\s*$/m.test(frontmatter),
      `${name} must remain explicitly invoked`
    );
  }

  const metadata = await readRepoFile(
    '.agents/skills/statly-engineering-workflow/agents/openai.yaml'
  );
  assert(
    /^\s*allow_implicit_invocation:\s*true\s*$/m.test(metadata),
    'Statly engineering workflow must allow implicit invocation'
  );
}

async function checkStatlyGuidance() {
  const agents = await readRepoFile('AGENTS.md');
  assert(
    agents.includes('.agents/skills/statly-engineering-workflow/SKILL.md'),
    'AGENTS.md must require the Statly engineering workflow'
  );
  assert(
    agents.includes('docs/agents/setup-matt-pocock-skills.md'),
    'AGENTS.md must reference the Statly-owned setup constraints'
  );
  assert(
    agents.includes('docs/agents/skill-routing.md'),
    'AGENTS.md must reference the Statly-owned skill-routing policy'
  );
  assert(
    agents.includes('npx skills update -p -y') && /never\s+directly against `main`/.test(agents),
    'AGENTS.md must constrain upstream updates to reviewed branches'
  );

  const workflow = await readRepoFile('.agents/skills/statly-engineering-workflow/SKILL.md');
  for (const requiredReference of [
    'grill-with-docs',
    'grilling',
    'prototype',
    'diagnosing-bugs',
    'codebase-design',
    'domain-modeling',
    'tdd',
    'to-spec',
    'to-tickets',
    'code-review',
    'docs/development/delivery.md',
  ]) {
    assert(
      workflow.includes(requiredReference),
      `Statly engineering workflow must reference ${requiredReference}`
    );
  }
  assert(
    workflow.includes('Never commit, push, open or merge a pull request'),
    'Statly engineering workflow must preserve delivery authority boundaries'
  );

  for (const skillName of requiredWorkflowSkills) {
    assert(
      await exists(`.agents/skills/${skillName}/SKILL.md`),
      `Statly engineering workflow references missing skill ${skillName}`
    );
  }
  assert(
    await exists('docs/development/delivery.md'),
    'Statly engineering workflow references missing delivery guidance'
  );
  assert(
    !agents.includes('$gstack-office-hours') && !workflow.includes('$gstack-office-hours'),
    'Statly workflow must not depend on an unapproved office-hours route'
  );

  const setupGuidance = await readRepoFile('docs/agents/setup-matt-pocock-skills.md');
  for (const requiredConstraint of [
    'statlyaus/Statly',
    'docs/domain/',
    'docs/architecture/',
    'Do not create `CONTEXT.md`',
    'Update the existing root',
    'The `triage` skill is not installed',
  ]) {
    assert(
      setupGuidance.includes(requiredConstraint),
      `Statly setup guidance must include ${requiredConstraint}`
    );
  }

  assert(await exists('docs/agents/issue-tracker.md'), 'Issue-tracker guidance is missing');
  assert(await exists('docs/agents/domain.md'), 'Domain-documentation guidance is missing');
  assert(await exists('docs/agents/skill-routing.md'), 'Skill-routing guidance is missing');

  const skillRouting = await readRepoFile('docs/agents/skill-routing.md');
  for (const requiredRoutingRule of [
    'not installed under `.agents/skills/` is unavailable',
    '`CONTEXT.md`',
    '`CONTEXT-MAP.md`',
    '`docs/adr/`',
  ]) {
    assert(
      skillRouting.includes(requiredRoutingRule),
      `Statly skill-routing guidance must include ${requiredRoutingRule}`
    );
  }
  assert(
    /must not be recommended or\s+invoked/.test(skillRouting),
    'Statly skill-routing guidance must prohibit unavailable routes'
  );

  const issueTracker = await readRepoFile('docs/agents/issue-tracker.md');
  assert(
    issueTracker.includes('--repo statlyaus/Statly'),
    'Issue-tracker commands must explicitly target statlyaus/Statly'
  );

  const domainGuidance = await readRepoFile('docs/agents/domain.md');
  assert(
    domainGuidance.includes('docs/domain/') && domainGuidance.includes('docs/architecture/'),
    'Domain guidance must reference Statly canonical documentation'
  );

  assert(!(await exists('CONTEXT.md')), 'Use docs/domain instead of a root CONTEXT.md');
  assert(!(await exists('CONTEXT-MAP.md')), 'Use docs/domain instead of a root CONTEXT-MAP.md');
  assert(!(await exists('docs/adr')), 'Use docs/architecture instead of docs/adr');
}

const skillCount = await checkSkillDirectories();
await checkLockfile();
await checkInvocationPolicies();
await checkStatlyGuidance();

console.log(`Agent skill checks passed for ${skillCount} repository skills.`);
