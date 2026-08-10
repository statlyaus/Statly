import type {
  AflTradeFitzRoyCapabilityId,
  AflTradeFitzRoyInvocation,
} from './fitzRoyCaptureContracts';
import {
  AFL_TRADE_FITZROY_CAPABILITIES,
  type AflTradeFitzRoyProvider,
} from './fitzRoyProviderCapabilities';

export type AflTradeFitzRoyCaptureAdmissionErrorCode =
  'INVALID_POLICY' | 'ADMISSION_UNAVAILABLE' | 'LEASE_LOST';

export class AflTradeFitzRoyCaptureAdmissionError extends Error {
  constructor(
    public readonly code: AflTradeFitzRoyCaptureAdmissionErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeFitzRoyCaptureAdmissionError';
  }
}

export interface AflTradeCaptureAdmissionRedis {
  acquire(input: {
    providerKey: string;
    requestKey: string;
    token: string;
    nowMs: number;
    leaseMs: number;
  }): Promise<{ acquired: true; expiresAtMs: number } | { acquired: false; retryAtMs: number }>;
  complete(input: {
    providerKey: string;
    requestKey: string;
    token: string;
    completedAtMs: number;
    providerCooldownMs: number;
    requestCooldownMs: number;
  }): Promise<boolean>;
}

export interface AflTradeFitzRoyCaptureAdmissionPolicy {
  upstreamRate: { requests: number; perSeconds: number; burst: number };
  cacheSeconds: number;
  maximumLeaseMs: number;
  egressPolicyEvidenceId: string;
}

export interface AflTradeFitzRoyCaptureAdmissionRequest {
  provider: AflTradeFitzRoyProvider;
  capabilityId: AflTradeFitzRoyCapabilityId;
  invocationSha256: string;
  policy: AflTradeFitzRoyCaptureAdmissionPolicy;
  nowMs: number;
}

export interface AflTradeFitzRoyCaptureLease {
  provider: AflTradeFitzRoyProvider;
  capabilityId: AflTradeFitzRoyCapabilityId;
  invocationSha256: string;
  token: string;
  providerKey: string;
  requestKey: string;
  expiresAtMs: number;
  providerCooldownMs: number;
  successRequestCooldownMs: number;
  egressPolicyEvidenceId: string;
}

export interface AflTradeFitzRoyCaptureAdmission {
  acquire(
    request: AflTradeFitzRoyCaptureAdmissionRequest
  ): Promise<
    | { status: 'admitted'; lease: AflTradeFitzRoyCaptureLease }
    | { status: 'deferred'; retryAtMs: number }
  >;
  complete(
    lease: AflTradeFitzRoyCaptureLease,
    result: { outcome: 'succeeded' | 'failed'; completedAtMs: number }
  ): Promise<void>;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function parsePolicy(
  request: AflTradeFitzRoyCaptureAdmissionRequest
): AflTradeFitzRoyCaptureAdmissionPolicy {
  const { policy } = request;
  const capability = AFL_TRADE_FITZROY_CAPABILITIES.find(
    (candidate) => candidate.capabilityId === request.capabilityId
  );
  if (
    capability === undefined ||
    capability.provider !== request.provider ||
    !/^[a-f0-9]{64}$/.test(request.invocationSha256) ||
    !Number.isSafeInteger(request.nowMs) ||
    request.nowMs < 0 ||
    !positiveInteger(policy.upstreamRate.requests) ||
    !positiveInteger(policy.upstreamRate.perSeconds) ||
    !positiveInteger(policy.upstreamRate.burst) ||
    policy.upstreamRate.burst < policy.upstreamRate.requests ||
    !positiveInteger(policy.cacheSeconds) ||
    !positiveInteger(policy.maximumLeaseMs) ||
    policy.maximumLeaseMs > 24 * 60 * 60 * 1_000 ||
    !/^artifact:[a-f0-9]{64}$/.test(policy.egressPolicyEvidenceId)
  ) {
    throw new AflTradeFitzRoyCaptureAdmissionError(
      'INVALID_POLICY',
      'Capture admission requires one exact capability, digest, clock, and reviewed upstream policy.'
    );
  }
  return policy;
}

function intervalMs(policy: AflTradeFitzRoyCaptureAdmissionPolicy): number {
  return Math.ceil((policy.upstreamRate.perSeconds * 1_000) / policy.upstreamRate.requests);
}

function storeFailure(operation: string, cause: unknown) {
  return new AflTradeFitzRoyCaptureAdmissionError(
    'ADMISSION_UNAVAILABLE',
    `Distributed capture ${operation} is unavailable; capture was not allowed to continue.`,
    { cause }
  );
}

export function createAflTradeRedisCaptureAdmission(input: {
  redis: AflTradeCaptureAdmissionRedis;
  createToken(): string;
}): AflTradeFitzRoyCaptureAdmission {
  return {
    async acquire(request) {
      const policy = parsePolicy(request);
      const token = input.createToken();
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(token)) {
        throw new AflTradeFitzRoyCaptureAdmissionError(
          'INVALID_POLICY',
          'The capture lease token is invalid.'
        );
      }
      const clusterSlot = `{${request.provider}}`;
      const providerKey = `afl-trade:capture:${clusterSlot}:provider`;
      const requestKey = `afl-trade:capture:${clusterSlot}:request:${request.capabilityId}:${request.invocationSha256}`;
      let stored;
      try {
        stored = await input.redis.acquire({
          providerKey,
          requestKey,
          token,
          nowMs: request.nowMs,
          leaseMs: policy.maximumLeaseMs,
        });
      } catch (cause) {
        throw storeFailure('admission', cause);
      }
      if (!stored.acquired) {
        return { status: 'deferred' as const, retryAtMs: stored.retryAtMs };
      }
      return {
        status: 'admitted' as const,
        lease: {
          provider: request.provider,
          capabilityId: request.capabilityId,
          invocationSha256: request.invocationSha256,
          token,
          providerKey,
          requestKey,
          expiresAtMs: stored.expiresAtMs,
          providerCooldownMs: intervalMs(policy),
          successRequestCooldownMs: policy.cacheSeconds * 1_000,
          egressPolicyEvidenceId: policy.egressPolicyEvidenceId,
        },
      };
    },
    async complete(lease, result) {
      if (!Number.isSafeInteger(result.completedAtMs) || result.completedAtMs < 0) {
        throw new AflTradeFitzRoyCaptureAdmissionError(
          'INVALID_POLICY',
          'Capture completion requires a valid distributed clock value.'
        );
      }
      let completed: boolean;
      try {
        completed = await input.redis.complete({
          providerKey: lease.providerKey,
          requestKey: lease.requestKey,
          token: lease.token,
          completedAtMs: result.completedAtMs,
          providerCooldownMs: lease.providerCooldownMs,
          requestCooldownMs:
            result.outcome === 'succeeded'
              ? lease.successRequestCooldownMs
              : lease.providerCooldownMs,
        });
      } catch (cause) {
        throw storeFailure('completion', cause);
      }
      if (!completed) {
        throw new AflTradeFitzRoyCaptureAdmissionError(
          'LEASE_LOST',
          'The distributed provider lease was lost before capture completion.'
        );
      }
    },
  };
}

export function createAflTradeCaptureAdmissionRequest(input: {
  invocation: AflTradeFitzRoyInvocation;
  invocationSha256: string;
  policy: AflTradeFitzRoyCaptureAdmissionPolicy;
  nowMs: number;
}): AflTradeFitzRoyCaptureAdmissionRequest {
  return {
    provider: input.invocation.provider,
    capabilityId: input.invocation.capabilityId,
    invocationSha256: input.invocationSha256,
    policy: input.policy,
    nowMs: input.nowMs,
  };
}
