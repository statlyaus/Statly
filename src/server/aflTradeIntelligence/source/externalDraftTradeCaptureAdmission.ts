export type AflTradeExternalCaptureProvider = 'draftguru' | 'footywire' | 'official_afl';

export interface AflTradeExternalCaptureAdmissionRedis {
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

export interface AflTradeExternalCaptureAdmissionPolicy {
  upstreamRate: { requests: number; perSeconds: number; burst: number };
  cacheSeconds: number;
  maximumLeaseMs: number;
  egressPolicyEvidenceId: string;
}

export interface AflTradeExternalCaptureAdmissionRequest {
  provider: AflTradeExternalCaptureProvider;
  capabilityId: string;
  requestSha256: string;
  policy: AflTradeExternalCaptureAdmissionPolicy;
  nowMs: number;
}

export interface AflTradeExternalCaptureLease {
  provider: AflTradeExternalCaptureProvider;
  capabilityId: string;
  requestSha256: string;
  token: string;
  providerKey: string;
  requestKey: string;
  expiresAtMs: number;
  providerCooldownMs: number;
  successRequestCooldownMs: number;
  egressPolicyEvidenceId: string;
}

export interface AflTradeExternalCaptureAdmission {
  acquire(
    request: AflTradeExternalCaptureAdmissionRequest
  ): Promise<
    | { status: 'admitted'; lease: AflTradeExternalCaptureLease }
    | { status: 'deferred'; retryAtMs: number }
  >;
  complete(
    lease: AflTradeExternalCaptureLease,
    result: { outcome: 'succeeded' | 'failed'; completedAtMs: number }
  ): Promise<void>;
}

export class AflTradeExternalCaptureAdmissionError extends Error {
  constructor(
    readonly code: 'INVALID_POLICY' | 'ADMISSION_UNAVAILABLE' | 'LEASE_LOST',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeExternalCaptureAdmissionError';
  }
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validateRequest(request: AflTradeExternalCaptureAdmissionRequest): void {
  const { policy } = request;
  if (
    !/^[a-z][a-z0-9-]{0,159}$/.test(request.capabilityId) ||
    !/^[a-f0-9]{64}$/.test(request.requestSha256) ||
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
    throw new AflTradeExternalCaptureAdmissionError(
      'INVALID_POLICY',
      'External capture admission requires one exact request digest and reviewed provider policy.'
    );
  }
}

function intervalMs(policy: AflTradeExternalCaptureAdmissionPolicy): number {
  return Math.ceil((policy.upstreamRate.perSeconds * 1_000) / policy.upstreamRate.requests);
}

function unavailable(operation: string, cause: unknown): AflTradeExternalCaptureAdmissionError {
  return new AflTradeExternalCaptureAdmissionError(
    'ADMISSION_UNAVAILABLE',
    `Distributed external capture ${operation} is unavailable; capture was not allowed to continue.`,
    { cause }
  );
}

export function createAflTradeExternalCaptureAdmission(input: {
  redis: AflTradeExternalCaptureAdmissionRedis;
  createToken(): string;
}): AflTradeExternalCaptureAdmission {
  return {
    async acquire(request) {
      validateRequest(request);
      const token = input.createToken();
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(token)) {
        throw new AflTradeExternalCaptureAdmissionError(
          'INVALID_POLICY',
          'The external capture lease token is invalid.'
        );
      }
      const clusterSlot = `{${request.provider}}`;
      const providerKey = `afl-trade:external-capture:${clusterSlot}:provider`;
      const requestKey =
        `afl-trade:external-capture:${clusterSlot}:request:` +
        `${request.capabilityId}:${request.requestSha256}`;
      let stored;
      try {
        stored = await input.redis.acquire({
          providerKey,
          requestKey,
          token,
          nowMs: request.nowMs,
          leaseMs: request.policy.maximumLeaseMs,
        });
      } catch (cause) {
        throw unavailable('admission', cause);
      }
      if (!stored.acquired) return { status: 'deferred' as const, retryAtMs: stored.retryAtMs };
      return {
        status: 'admitted' as const,
        lease: {
          provider: request.provider,
          capabilityId: request.capabilityId,
          requestSha256: request.requestSha256,
          token,
          providerKey,
          requestKey,
          expiresAtMs: stored.expiresAtMs,
          providerCooldownMs: intervalMs(request.policy),
          successRequestCooldownMs: request.policy.cacheSeconds * 1_000,
          egressPolicyEvidenceId: request.policy.egressPolicyEvidenceId,
        },
      };
    },
    async complete(lease, result) {
      if (!Number.isSafeInteger(result.completedAtMs) || result.completedAtMs < 0) {
        throw new AflTradeExternalCaptureAdmissionError(
          'INVALID_POLICY',
          'External capture completion requires a valid distributed clock.'
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
        throw unavailable('completion', cause);
      }
      if (!completed) {
        throw new AflTradeExternalCaptureAdmissionError(
          'LEASE_LOST',
          'The distributed external capture lease was lost before completion.'
        );
      }
    },
  };
}
