import { Buffer } from 'node:buffer';

export const AFL_TRADE_LOCAL_OUTCOMES_PORT = 55432;
export const AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${AFL_TRADE_LOCAL_OUTCOMES_PORT}/statly_outcomes_test?sslmode=disable`;

const cursorSecret = Buffer.from('statly-local-only-cursor-secret-v1', 'utf8').toString('base64');

/**
 * Explicit local-only composition for the isolated public AFL archive.
 * It carries test-fixture authority and cannot be promoted to a production environment.
 */
export function createLocalAflTradePublicReadEnvironment(input: {
  artifactRootDirectory: string;
}): Readonly<Record<string, string>> {
  return Object.freeze({
    AFL_TRADE_PUBLIC_READ_MODE: 'postgres',
    AFL_TRADE_PUBLIC_READ_ENVIRONMENT: 'test_fixture',
    AFL_OUTCOMES_DATABASE_URL: AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL,
    AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64: cursorSecret,
    AFL_TRADE_LOCAL_ARTIFACT_ROOT: input.artifactRootDirectory,
  });
}
