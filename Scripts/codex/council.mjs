#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { runCouncil } from './council-core.mjs';

const DEFAULT_PROVIDER = 'logical';
const LOGICAL_MEMBERS = [
  'The Contrarian',
  'First Principles',
  'The Expansionist',
  'The Outsider',
  'The Executor',
];
const LOGICAL_CHAIRMAN = 'Chairman';
const OPENROUTER_MODELS = [
  'openai/gpt-5.1',
  'google/gemini-3-pro-preview',
  'anthropic/claude-sonnet-4.5',
  'x-ai/grok-4',
];
const OLLAMA_MODELS = ['llama3.1:8b', 'qwen2.5-coder:7b', 'mistral-nemo:12b'];
const OLLAMA_CHAIRMAN = 'qwen2.5-coder:7b';
const OPENROUTER_CHAIRMAN = 'google/gemini-3-pro-preview';
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_MAX_CHARS = 70000;
const DEFAULT_TIMEOUT_SECONDS = 120;
const STATLY_CONTEXT =
  'You are advising a Codex coding session in Statly, an AFL Fantasy Next.js/React/TypeScript project. Prioritize durable root-cause fixes, coherent auth/data-boundary behavior, shadcn/ui theme tokens, accessibility, regression tests, and reviewable scope.';
const HELP = `Usage:
  npm run codex:council -- --prompt "Question for the council"
  npm run codex:council:diff -- --prompt "Review the current worktree"

Options:
  --prompt <text>       Prompt text. Positional text is also accepted.
  --diff               Include staged and unstaged git diffs.
  --staged             Include only staged git diff.
  --provider <name>     logical (free), ollama (free/local), or openrouter (paid). Default: ${DEFAULT_PROVIDER}.
  --models <csv>       Override LLM_COUNCIL_MODELS/default models.
  --chairman <model>   Override LLM_COUNCIL_CHAIRMAN/default chairman.
  --base-url <url>      Override OLLAMA_BASE_URL. Default: ${DEFAULT_OLLAMA_URL}.
  --max-chars <n>      Limit combined prompt/diff context. Default: ${DEFAULT_MAX_CHARS}.
  --timeout <seconds>  Per-request timeout. Default: ${DEFAULT_TIMEOUT_SECONDS}.
  --dry-run            Print assembled prompt without calling any model provider.
  --help               Show this help.

The logical provider does not call any model. Ollama runs locally. OpenRouter requires OPENROUTER_API_KEY.`;

const originalEnv = new Set(Object.keys(process.env));
const repoRoot = gitRoot();
[
  join(homedir(), '.config/statly/llm-council.env'),
  join(homedir(), '.config/codex/llm-council.env'),
  join(repoRoot, '.env'),
  join(repoRoot, '.env.local'),
].forEach(loadEnv);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(HELP);

  const prompt = buildPrompt(options);
  if (!prompt.trim()) throw new Error(HELP);

  const provider = options.provider ?? process.env.LLM_COUNCIL_PROVIDER ?? DEFAULT_PROVIDER;
  if (!['logical', 'ollama', 'openrouter'].includes(provider)) {
    throw new Error(
      `Unsupported council provider: ${provider}. Use logical, ollama, or openrouter.`
    );
  }

  const defaultModels =
    provider === 'logical'
      ? LOGICAL_MEMBERS
      : provider === 'ollama'
        ? OLLAMA_MODELS
        : OPENROUTER_MODELS;
  const defaultChairman =
    provider === 'logical'
      ? LOGICAL_CHAIRMAN
      : provider === 'ollama'
        ? OLLAMA_CHAIRMAN
        : OPENROUTER_CHAIRMAN;
  const models = list(options.models ?? process.env.LLM_COUNCIL_MODELS, defaultModels);
  const chairman = options.chairman ?? process.env.LLM_COUNCIL_CHAIRMAN ?? defaultChairman;
  const baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_URL;
  const timeoutMs = positiveInt(options.timeout, DEFAULT_TIMEOUT_SECONDS) * 1000;

  if (options.dryRun) {
    console.log(`# LLM Council Dry Run

Models: ${models.join(', ')}
Chairman: ${chairman}
Provider: ${provider}${provider === 'ollama' ? ` (${baseUrl})` : ''}
Context chars: ${prompt.length}

${prompt}`);
    return;
  }

  if (provider === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
    throw new Error(
      'OPENROUTER_API_KEY is required. Set it in the environment, .env.local, or ~/.config/statly/llm-council.env.'
    );
  }

  const result = await runCouncil({
    prompt,
    models,
    chairman,
    provider,
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl,
    timeoutMs,
  });
  console.log(formatResult(result));
}

function parseArgs(args) {
  const options = {
    prompt: [],
    diff: false,
    provider: null,
    models: null,
    chairman: null,
    baseUrl: null,
    maxChars: DEFAULT_MAX_CHARS,
    timeout: DEFAULT_TIMEOUT_SECONDS,
    dryRun: false,
    help: false,
  };
  const take = (index, flag) => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--prompt') options.prompt.push(take(index++, arg));
    else if (arg === '--diff') options.diff = 'working';
    else if (arg === '--staged') options.diff = 'staged';
    else if (arg === '--provider') options.provider = take(index++, arg);
    else if (arg === '--models') options.models = take(index++, arg);
    else if (arg === '--chairman') options.chairman = take(index++, arg);
    else if (arg === '--base-url') options.baseUrl = take(index++, arg);
    else if (arg === '--max-chars')
      options.maxChars = positiveInt(take(index++, arg), DEFAULT_MAX_CHARS);
    else if (arg === '--timeout')
      options.timeout = positiveInt(take(index++, arg), DEFAULT_TIMEOUT_SECONDS);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else options.prompt.push(arg);
  }
  return options;
}

function buildPrompt(options) {
  const parts = [STATLY_CONTEXT];
  if (!process.stdin.isTTY) {
    const stdin = readFileSync(0, 'utf8').trim();
    if (stdin) parts.push(`Prompt from stdin:\n${stdin}`);
  }
  if (options.prompt.length) parts.push(`User request:\n${options.prompt.join(' ')}`);
  if (options.diff) parts.push(diffContext(options.diff));
  return truncate(redact(parts.join('\n\n')), options.maxChars);
}

function diffContext(mode) {
  const untrackedFiles = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean);
  if (mode === 'staged') {
    return [
      'Git status:',
      git(['status', '--short']) || '(clean)',
      'Staged diff:',
      git(['diff', '--cached', '--']) || '(none)',
    ].join('\n');
  }

  return [
    'Git status:',
    git(['status', '--short']) || '(clean)',
    'Staged diff:',
    git(['diff', '--cached', '--']) || '(none)',
    'Unstaged diff:',
    git(['diff', '--']) || '(none)',
    'Untracked files:',
    untrackedFiles.length ? untrackedFiles.map(untrackedContext).join('\n\n') : '(none)',
  ].join('\n');
}

function untrackedContext(file) {
  const bytes = readFileSync(join(repoRoot, file));
  return bytes.includes(0)
    ? `--- ${file}\n(binary file)`
    : `--- ${file}\n${bytes.toString('utf8')}`;
}

function formatResult(result) {
  const header = `# Statly LLM Council

Models: ${result.models.join(', ')}
Chairman: ${result.chairman}
Provider: ${result.provider}
Prompt chars: ${result.promptChars}

`;
  if (result.provider === 'logical') return `${header}${result.final.response}`;

  const ranking = result.aggregate.length
    ? `\n\n## Aggregate Ranking\n${result.aggregate
        .map((entry, index) => `${index + 1}. ${entry.model} - average rank ${entry.averageRank}`)
        .join('\n')}`
    : '';
  return `${header}## Final Synthesis
${result.final.response}${ranking}

## Stage 1
${result.stage1.map((entry) => `- ${entry.label} - ${entry.model}: ${summary(entry.response)}`).join('\n')}

## Stage 2
${result.stage2.map((entry) => `- ${entry.model}: ${entry.parsedRanking.join(' > ') || 'ranking not parsed'}; ${summary(entry.ranking)}`).join('\n') || '(skipped)'}`;
}

function gitRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : process.cwd();
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 25 * 1024 * 1024,
  });
  return result.status === 0
    ? result.stdout.trim()
    : `git ${args.join(' ')} failed:\n${result.stderr.trim()}`;
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const [key, value] of Object.entries(dotenv.parse(readFileSync(path)))) {
    if (!originalEnv.has(key)) process.env[key] = value;
  }
}

function list(value, fallback) {
  const models = value
    ?.split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  return models?.length ? models : fallback;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.65);
  return `${text.slice(0, head)}\n\n[...truncated ${text.length - maxChars} characters...]\n\n${text.slice(-(maxChars - head))}`;
}

function redact(text) {
  return text
    .replaceAll(/sk-or-v1-[A-Za-z0-9_-]+/g, 'sk-or-v1-[redacted]')
    .replaceAll(/sk-[A-Za-z0-9_-]{20,}/g, 'sk-[redacted]')
    .replaceAll(/(^|\n)(OPENROUTER_API_KEY)=([^\n]+)/g, '$1$2=[redacted]');
}

function summary(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}
