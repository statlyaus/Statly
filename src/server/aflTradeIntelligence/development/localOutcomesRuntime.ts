import { Buffer } from 'node:buffer';

export const AFL_TRADE_LOCAL_OUTCOMES_PORT = 55432;
export const AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${AFL_TRADE_LOCAL_OUTCOMES_PORT}/postgres?sslmode=disable`;

const cursorSecret = Buffer.from('statly-local-only-cursor-secret-v1', 'utf8').toString('base64');
const fixtureEvidenceId = `artifact:${'d'.repeat(64)}`;

/**
 * Explicit local-only composition for the isolated public AFL archive.
 * It carries test-fixture authority and cannot be promoted to a production environment.
 */
export function createLocalAflTradePublicReadEnvironment(): Readonly<Record<string, string>> {
  return Object.freeze({
    AFL_TRADE_PUBLIC_READ_MODE: 'postgres',
    AFL_TRADE_PUBLIC_READ_ENVIRONMENT: 'test_fixture',
    AFL_OUTCOMES_DATABASE_URL: AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL,
    AFL_OUTCOMES_CURSOR_HMAC_SECRET_B64: cursorSecret,
    AFL_TRADE_OBJECT_BUCKET: 'statly-local-afl-trade-projections',
    AFL_TRADE_OBJECT_PREFIX: 'test-fixture',
    AFL_TRADE_OBJECT_KMS_KEY_ID: 'statly-local-only-no-production-authority',
    AFL_TRADE_OBJECT_REPOSITORY_ID: 'statly-local-afl-trade-projections',
    AFL_TRADE_OBJECT_POLICY_EVIDENCE_ID: fixtureEvidenceId,
    AWS_REGION: 'ap-southeast-2',
    AWS_EC2_METADATA_DISABLED: 'true',
  });
}
