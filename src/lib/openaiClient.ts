import OpenAI from 'openai';

/**
 * Creates a configured OpenAI client.
 * Prefers OPENAI_API_KEY but falls back to GITHUB_TOKEN for compatibility.
 * Throws if no API key is available.
 */
export function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.GITHUB_TOKEN;
  if (!apiKey) {
    throw new Error('Missing OpenAI API key');
  }

  const baseURL = process.env.OPENAI_BASE_URL || 'https://models.inference.ai.azure.com';

  return new OpenAI({ apiKey, baseURL });
}
