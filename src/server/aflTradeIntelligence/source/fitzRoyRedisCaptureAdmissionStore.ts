import type { AflTradeCaptureAdmissionRedis } from './fitzRoyCaptureAdmission';

export interface AflTradeRedisEvalClient {
  eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

const ACQUIRE_SCRIPT = `
local nowMs = tonumber(ARGV[2])
local leaseMs = tonumber(ARGV[3])
local leaseToken = redis.call('GET', KEYS[1])

if leaseToken then
  local leaseTtl = redis.call('PTTL', KEYS[1])
  if leaseTtl < 0 then return {-1, 0} end
  return {0, nowMs + leaseTtl}
end

local providerUntil = tonumber(redis.call('GET', KEYS[2]) or '0')
local requestUntil = tonumber(redis.call('GET', KEYS[3]) or '0')
local retryAt = math.max(providerUntil, requestUntil)
if retryAt > nowMs then return {0, retryAt} end

local acquired = redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', leaseMs)
if not acquired then
  local leaseTtl = redis.call('PTTL', KEYS[1])
  if leaseTtl < 0 then return {-1, 0} end
  return {0, nowMs + leaseTtl}
end

return {1, nowMs + leaseMs}
`;

const COMPLETE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end

local completedAtMs = tonumber(ARGV[2])
local providerCooldownMs = tonumber(ARGV[3])
local requestCooldownMs = tonumber(ARGV[4])
redis.call(
  'SET', KEYS[2], tostring(completedAtMs + providerCooldownMs), 'PX', providerCooldownMs
)
redis.call(
  'SET', KEYS[3], tostring(completedAtMs + requestCooldownMs), 'PX', requestCooldownMs
)
redis.call('DEL', KEYS[1])
return 1
`;

function safeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseAcquireResult(
  value: unknown
): { acquired: true; expiresAtMs: number } | { acquired: false; retryAtMs: number } {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new TypeError('Redis capture admission returned a malformed result.');
  }
  const state = safeInteger(value[0]);
  const timestamp = safeInteger(value[1]);
  if ((state !== 0 && state !== 1) || timestamp === null) {
    throw new TypeError('Redis capture admission returned a malformed result.');
  }
  return state === 1
    ? { acquired: true, expiresAtMs: timestamp }
    : { acquired: false, retryAtMs: timestamp };
}

export function createAflTradeIoredisCaptureAdmissionStore(
  client: AflTradeRedisEvalClient
): AflTradeCaptureAdmissionRedis {
  return {
    async acquire(input) {
      const result = await client.eval(
        ACQUIRE_SCRIPT,
        3,
        input.providerKey,
        `${input.providerKey}:cooldown`,
        input.requestKey,
        input.token,
        String(input.nowMs),
        String(input.leaseMs)
      );
      return parseAcquireResult(result);
    },
    async complete(input) {
      const result = await client.eval(
        COMPLETE_SCRIPT,
        3,
        input.providerKey,
        `${input.providerKey}:cooldown`,
        input.requestKey,
        input.token,
        String(input.completedAtMs),
        String(input.providerCooldownMs),
        String(input.requestCooldownMs)
      );
      const completed = safeInteger(result);
      if (completed !== 0 && completed !== 1) {
        throw new TypeError('Redis capture completion returned a malformed result.');
      }
      return completed === 1;
    },
  };
}
