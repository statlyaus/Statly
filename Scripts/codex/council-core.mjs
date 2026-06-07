import { runLogicalCouncil } from './council-logical.mjs';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function runCouncil({
  prompt,
  models,
  chairman,
  provider,
  apiKey,
  baseUrl,
  timeoutMs,
}) {
  if (provider === 'logical') {
    return runLogicalCouncil({ prompt, models, chairman, provider });
  }

  const client = { provider, apiKey, baseUrl };
  console.error(`Stage 1: querying ${models.length} council models...`);
  const stage1 = (await askAll(models, memberMessages(prompt), client, timeoutMs))
    .filter((entry) => entry.response)
    .map((entry, index) => ({
      label: `Response ${String.fromCharCode(65 + index)}`,
      model: entry.model,
      response: entry.response,
    }));

  if (stage1.length === 0) {
    throw new Error('No council model returned a stage 1 response.');
  }

  console.error(`Stage 2: collecting peer rankings for ${stage1.length} responses...`);
  const stage2 =
    stage1.length > 1
      ? (await askAll(models, reviewMessages(prompt, stage1), client, timeoutMs))
          .filter((entry) => entry.response)
          .map((entry) => ({
            model: entry.model,
            ranking: entry.response,
            parsedRanking: parseRanking(entry.response),
          }))
      : [];

  const labelToModel = Object.fromEntries(stage1.map((entry) => [entry.label, entry.model]));
  const aggregate = aggregateRankings(stage2, labelToModel);

  console.error(`Stage 3: asking chairman ${chairman} for synthesis...`);
  const final = await askOne(
    chairman,
    chairmanMessages(prompt, stage1, stage2, aggregate),
    client,
    timeoutMs
  ).catch((error) => ({
    model: chairman,
    response: `Chairman synthesis failed: ${error instanceof Error ? error.message : String(error)}`,
  }));

  return {
    provider,
    models,
    chairman,
    promptChars: prompt.length,
    stage1,
    stage2,
    aggregate,
    final,
  };
}

function memberMessages(prompt) {
  return [
    {
      role: 'system',
      content:
        'You are one Statly LLM Council member. Give direct coding advice with risks, implementation boundaries, tests, tradeoffs, and a long-term recommendation.',
    },
    { role: 'user', content: prompt },
  ];
}

function reviewMessages(prompt, stage1) {
  const responses = stage1.map((entry) => `${entry.label}:\n${entry.response}`).join('\n\n');
  return [
    {
      role: 'system',
      content:
        'Rank anonymized Statly engineering responses by correctness, maintainability, project fit, and usefulness.',
    },
    {
      role: 'user',
      content: `Original prompt:\n${prompt}\n\nAnonymized responses:\n${responses}\n\nEvaluate briefly, then end exactly like:\n\nFINAL RANKING:\n1. Response A\n2. Response B`,
    },
  ];
}

function chairmanMessages(prompt, stage1, stage2, aggregate) {
  const first = stage1.map((entry) => `Model: ${entry.model}\n${entry.response}`).join('\n\n');
  const reviews =
    stage2.map((entry) => `Model: ${entry.model}\n${entry.ranking}`).join('\n\n') || '(skipped)';
  const ranks = aggregate
    .map((entry, index) => `${index + 1}. ${entry.model} avg=${entry.averageRank}`)
    .join('\n');
  return [
    {
      role: 'system',
      content:
        'You are chairman of Statly LLM Council. Synthesize the debate, choose the best long-term option, and emit explicit CHAIRMAN DECISION lines. Do not ask for approval after deciding.',
    },
    {
      role: 'user',
      content: `Original prompt:\n${prompt}\n\nStage 1 responses:\n${first}\n\nStage 2 peer rankings:\n${reviews}\n\nAggregate ranking:\n${ranks || '(none)'}\n\nProduce Committee Debate, Chairman Decision, risks, verification, and one concrete next step.`,
    },
  ];
}

async function askAll(models, messages, client, timeoutMs) {
  const settled = await Promise.allSettled(
    models.map((model) => askOne(model, messages, client, timeoutMs))
  );
  return settled.map((result, index) =>
    result.status === 'fulfilled'
      ? result.value
      : { model: models[index], response: '', error: String(result.reason) }
  );
}

async function askOne(model, messages, client, timeoutMs) {
  if (client.provider === 'ollama') {
    return askOllama(model, messages, client.baseUrl, timeoutMs);
  }
  return askOpenRouter(model, messages, client.apiKey, timeoutMs);
}

async function askOpenRouter(model, messages, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/statlyaus/Statly',
        'X-Title': 'Statly Codex LLM Council',
      },
      body: JSON.stringify({ model, messages, temperature: 0.2 }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${model} failed with ${response.status}: ${text.slice(0, 500)}`);
    }

    const content = JSON.parse(text)?.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${model} returned no content.`);
    return { model, response: content };
  } finally {
    clearTimeout(timer);
  }
}

async function askOllama(model, messages, baseUrl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0.2 } }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${model} failed with ${response.status}: ${text.slice(0, 500)}`);
    }

    const content = JSON.parse(text)?.message?.content;
    if (!content) throw new Error(`${model} returned no content.`);
    return { model, response: content };
  } finally {
    clearTimeout(timer);
  }
}

function aggregateRankings(stage2, labelToModel) {
  const positions = new Map();
  for (const entry of stage2) {
    entry.parsedRanking.forEach((label, index) => {
      const model = labelToModel[label];
      if (!model) return;
      positions.set(model, [...(positions.get(model) ?? []), index + 1]);
    });
  }

  return Array.from(positions.entries())
    .map(([model, ranks]) => ({
      model,
      averageRank:
        Math.round((ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length) * 100) / 100,
      rankingsCount: ranks.length,
    }))
    .sort((left, right) => left.averageRank - right.averageRank);
}

function parseRanking(text) {
  const section = text.split('FINAL RANKING:')[1] ?? text;
  return Array.from(section.matchAll(/\d+\.\s*(Response [A-Z])/g), (match) => match[1]);
}
