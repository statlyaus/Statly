#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as prettier from 'prettier';

const requiredDocuments = [
  'AGENTS.md',
  'README.md',
  '.agents/skills/docs-sweep-loop/SKILL.md',
  '.agents/skills/draft-reliability-loop/SKILL.md',
  '.agents/skills/product-design-review/SKILL.md',
  'docs/README.md',
  'docs/architecture/data-platform.md',
  'docs/architecture/realtime.md',
  'docs/domain/fantasy-model.md',
  'docs/domain/draft-and-waivers.md',
  'docs/development/setup.md',
  'docs/development/testing.md',
  'docs/development/dependency-overrides.md',
  'docs/development/delivery.md',
  'docs/product/league-competition-rules.md',
  'docs/product/design-principles.md',
  'docs/runbooks/postgresql-cutover.md',
  'docs/runbooks/player-identity.md',
  'etl/README.md',
];

const staleReferencePatterns = [
  ['Claude instructions', /(?:^|[\s`(])CLAUDE\.md(?:$|[\s`)])/i],
  ['Gemini configuration', /\.gemini\//i],
  ['Codex council scripts', /Scripts\/codex\//i],
  ['removed Codex docs', /docs\/codex\//i],
  ['council command', /codex:council|codex:commit:reviewed|llm-council/i],
  [
    'removed generic skill',
    /\.agents\/skills\/(?:completion-contract-loop|fresh-clone-loop|pr-babysitter|quality-streak-loop|repository-cleanup-loop|ticket-to-pr-ready-loop)\//i,
  ],
];

export const absoluteLocalPathPatterns = [
  /(?:^|[\s`('"=])\/Users\//m,
  /(?:^|[\s`('"=])\/home\/(?!runner(?:\/|$))/m,
  /(?:^|[\s`('"=])\/var\/folders\//m,
  /(?:^|[\s`('"=])file:\/\//im,
  /(?:^|[\s`('"=])[A-Z]:\\Users\\/im,
];

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await run();
}

async function run() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const errors = [];
  const markdownFiles = listMarkdownFiles(root);
  const trackedFiles = listGitFiles(root, ['ls-files']);

  for (const required of requiredDocuments) {
    if (!existsSync(join(root, required))) {
      errors.push(`${required}: required canonical document is missing`);
    }
  }

  for (const file of trackedFiles) {
    if (isProhibitedTrackedEnvironment(file)) {
      errors.push(`${file}: tracked non-example environment or credential file`);
    }
  }

  for (const relativeFile of markdownFiles) {
    const absoluteFile = join(root, relativeFile);
    const content = readFileSync(absoluteFile, 'utf8');
    const prose = stripFencedCode(content, relativeFile, (error) => errors.push(error));

    const prettierConfig = (await prettier.resolveConfig(absoluteFile)) ?? {};
    if (!(await prettier.check(content, { ...prettierConfig, filepath: absoluteFile }))) {
      errors.push(`${relativeFile}: Markdown is not formatted with Prettier`);
    }

    if (absoluteLocalPathPatterns.some((pattern) => pattern.test(prose))) {
      errors.push(`${relativeFile}: contains a prohibited local absolute path`);
    }

    for (const [label, pattern] of staleReferencePatterns) {
      if (pattern.test(prose)) {
        errors.push(`${relativeFile}: contains stale ${label} reference`);
      }
    }

    errors.push(...validateMarkdownLinks(root, relativeFile, prose));
  }

  if (errors.length > 0) {
    console.error(`Documentation checks failed (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Documentation checks passed: ${markdownFiles.length} Markdown files, ${trackedFiles.length} tracked files, no prohibited environment files.`
    );
  }
}

function listGitFiles(root, args) {
  const [command, ...commandArgs] = args;
  const output = execFileSync('git', [command, '-z', ...commandArgs], { cwd: root });
  return output.toString('utf8').split('\0').filter(Boolean).sort();
}

function listMarkdownFiles(root) {
  return listGitFiles(root, [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '*.md',
    '*.MD',
  ]).filter((file) => extname(file).toLowerCase() === '.md');
}

export function isProhibitedTrackedEnvironment(file) {
  const normalizedFile = file.replaceAll('\\', '/');
  const name = normalizedFile.split('/').at(-1) ?? '';
  const lowerName = name.toLowerCase();
  const isExample = /(?:example|sample|template)/i.test(name);

  if (name === '.Renviron') return true;
  if ((lowerName === '.env' || lowerName.startsWith('.env.')) && !isExample) return true;
  if (lowerName === '.envrc') return true;
  if (name.startsWith('ENV.') && /^[A-Z0-9._-]+$/.test(name) && !isExample) return true;

  if (isExample) return false;

  if (/^(?:sa\.b64|sa\.dec\.json|key\.txt)$/i.test(name)) return true;

  const hasCredentialExtension = /\.(?:json|b64|txt|pem|p12|key)$/i.test(name);
  const hasCredentialLikeName =
    /(?:service[-_.]?account|firebase[-_.]?(?:admin|credential)|google[-_.]?(?:application[-_.]?)?credentials?|private[-_.]?key)/i.test(
      name
    );

  return hasCredentialExtension && hasCredentialLikeName;
}

export function stripFencedCode(content, file, reportError = (_error) => {}) {
  const lines = content.split('\n');
  let fence = null;

  const visible = lines.map((line, index) => {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (match) {
      const marker = match[1][0];
      const length = match[1].length;
      if (fence === null) fence = { marker, length, line: index + 1 };
      else if (fence.marker === marker && length >= fence.length) fence = null;
      return '';
    }
    return fence === null ? line : '';
  });

  if (fence !== null) {
    reportError(`${file}: unclosed fenced code block opened at line ${fence.line}`);
  }
  return visible.join('\n');
}

export function validateMarkdownLinks(root, sourceFile, content) {
  const linkErrors = [];
  const definitions = new Map();
  const definitionPattern = /^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm;

  for (const match of content.matchAll(definitionPattern)) {
    const label = normalizeReferenceLabel(match[1]);
    const target = match[2] ?? match[3];
    definitions.set(label, target);
    validateLinkTarget(target);
  }

  const referenceUsagePattern = /!?\[([^\]]+)\]\[([^\]]*)\]/g;
  for (const match of content.matchAll(referenceUsagePattern)) {
    const label = normalizeReferenceLabel(match[2] || match[1]);
    if (!definitions.has(label)) {
      linkErrors.push(`${sourceFile}: missing Markdown reference definition: ${label}`);
    }
  }

  const linkPattern = /!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].replace(/^<|>$/g, '');
    validateLinkTarget(rawTarget);
  }

  return linkErrors;

  function validateLinkTarget(rawTarget) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) return;

    if (rawTarget.startsWith('#')) {
      const anchor = decodeURIComponent(rawTarget.slice(1));
      if (!hasMarkdownAnchor(join(root, sourceFile), anchor)) {
        linkErrors.push(`${sourceFile}: missing Markdown anchor in ${rawTarget}`);
      }
      return;
    }

    const [encodedPath, anchor] = rawTarget.split('#', 2);
    const pathPart = decodeURIComponent(encodedPath.split('?', 1)[0]);
    const candidate = resolve(root, dirname(sourceFile), pathPart || '.');

    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      linkErrors.push(`${sourceFile}: relative link escapes the repository: ${rawTarget}`);
      return;
    }

    const targetFile = resolveLinkTarget(candidate);
    if (!targetFile) {
      linkErrors.push(`${sourceFile}: broken relative link: ${rawTarget}`);
      return;
    }

    if (
      anchor &&
      extname(targetFile).toLowerCase() === '.md' &&
      !hasMarkdownAnchor(targetFile, decodeURIComponent(anchor))
    ) {
      linkErrors.push(`${sourceFile}: missing Markdown anchor in ${rawTarget}`);
    }
  }
}

function resolveLinkTarget(candidate) {
  if (!existsSync(candidate)) return null;
  if (statSync(candidate).isDirectory()) {
    const readme = join(candidate, 'README.md');
    return existsSync(readme) ? readme : null;
  }
  return candidate;
}

function hasMarkdownAnchor(targetFile, anchor) {
  const targetContent = readFileSync(targetFile, 'utf8');
  const prose = stripFencedCode(targetContent, targetFile);
  const anchors = new Set();
  const seen = new Map();

  for (const line of prose.split('\n')) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (!heading) continue;

    const base = githubSlug(heading);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }

  return anchors.has(anchor.toLowerCase());
}

function normalizeReferenceLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function githubSlug(value) {
  return value
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}
