import { z } from 'zod';

import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import type {
  AflTradeStoredGateLedger,
  AflTradeGateDecisionLedgerRepository,
} from '../governance/postgresGateDecisionLedgerRepository';
import type { AflTradeDecisionEnvironment } from '../governance/gateDecisionTypes';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  type AflTradePublicationMutationResult,
  type AflTradePublicationRepository,
} from './postgresPublicationRepository';
import {
  persistPostgresAflTradeProjectionRelease,
  type AflTradeProjectionReleaseCustodyResult,
} from './postgresProjectionReleaseCustody';
import { authenticateAflTradeProjectionReleaseArtifact } from './projectionReleaseArtifact';
import {
  aflTradeValuationOutputCustodyIndexVerificationSchema,
  createAflTradeCustodiedPublicationManifest,
} from '../valuation/valuationOutputCustodyIndex';

const actorSchema = z.string().trim().min(1).max(200);
const evidenceIdSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/);
const dispositionReasonSchema = z.string().trim().min(1).max(2_000);

interface TrustedTimeRow extends Record<string, unknown> {
  trusted_at: string | Date;
}

export interface AflTradeValuationPublicationValidationResult {
  readonly custody: AflTradeProjectionReleaseCustodyResult;
  readonly mutation: AflTradePublicationMutationResult;
}

export interface AflTradeValuationPublicationRegistrationResult {
  readonly publication: ReturnType<typeof createAflTradeCustodiedPublicationManifest>;
  readonly mutation: AflTradePublicationMutationResult;
}

export interface AflTradeValuationPublicationRegisterInput {
  publicationCandidate: unknown;
  custodyIndexVerification: unknown;
  actor: string;
}

export interface AflTradeValuationPublicationValidateInput {
  verification: unknown;
  actor: string;
}

export interface AflTradeValuationPublicationAuthorizeInput {
  action: 'approve' | 'publish';
  publicationId: string;
  gateDecisionId: string;
  actor: string;
}

export interface AflTradeValuationPublicationDispositionInput {
  action: 'reject' | 'withdraw';
  publicationId: string;
  actor: string;
  evidenceId: string;
  reason: string;
}

export interface AflTradeValuationPublicationCommandService {
  register(
    input: AflTradeValuationPublicationRegisterInput
  ): Promise<AflTradeValuationPublicationRegistrationResult>;
  validate(
    input: AflTradeValuationPublicationValidateInput
  ): Promise<AflTradeValuationPublicationValidationResult>;
  authorize(
    input: AflTradeValuationPublicationAuthorizeInput
  ): Promise<AflTradePublicationMutationResult>;
  disposition(
    input: AflTradeValuationPublicationDispositionInput
  ): Promise<AflTradePublicationMutationResult>;
}

export interface AflTradeValuationPublicationCommandServiceDependencies {
  client: AflOutcomeSqlClient;
  publicationRepository: AflTradePublicationRepository;
  gateRepository: Pick<AflTradeGateDecisionLedgerRepository, 'load'>;
  environment: AflTradeDecisionEnvironment;
  persistProjectionRelease(input: {
    verification: unknown;
  }): Promise<AflTradeProjectionReleaseCustodyResult>;
}

async function trustedNow(client: AflOutcomeSqlClient): Promise<string> {
  const result = await client.query<TrustedTimeRow>(
    `SELECT date_trunc('milliseconds',clock_timestamp()) AS trusted_at`
  );
  if (result.rows.length !== 1) {
    throw new TypeError('Valuation publication requires one trusted PostgreSQL timestamp.');
  }
  const value = result.rows[0].trusted_at;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requireGateLedger(stored: AflTradeStoredGateLedger): AflTradeStoredGateLedger['ledger'] {
  if (!Number.isSafeInteger(stored.revision) || stored.revision < 0) {
    throw new TypeError('Valuation publication requires a valid durable Gate ledger revision.');
  }
  return stored.ledger;
}

export function createAflTradeValuationPublicationCommandService(
  dependencies: AflTradeValuationPublicationCommandServiceDependencies
): AflTradeValuationPublicationCommandService {
  return Object.freeze({
    async register(input: AflTradeValuationPublicationRegisterInput) {
      const actor = actorSchema.parse(input.actor);
      const custodyIndexVerification = aflTradeValuationOutputCustodyIndexVerificationSchema.parse(
        input.custodyIndexVerification
      );
      const publication = createAflTradeCustodiedPublicationManifest({
        publicationCandidate: input.publicationCandidate,
        custodyIndexVerification,
      });
      if (publication.publicationManifest.content.environment !== dependencies.environment) {
        throw new TypeError(
          'Valuation publication registration cannot cross the configured environment boundary.'
        );
      }
      const current = await dependencies.publicationRepository.load();
      const mutation = await dependencies.publicationRepository.register({
        expectedRevision: current.revision,
        manifest: publication.publicationManifest,
        actor,
        evidenceId:
          publication.publicationManifest.content.valuationOutputCustodyIndex
            .valuationOutputCustodyIndexId,
        custodyIndexVerification,
      });
      return Object.freeze({ publication, mutation });
    },

    async validate(input: AflTradeValuationPublicationValidateInput) {
      const authenticated = authenticateAflTradeProjectionReleaseArtifact(input.verification);
      if (authenticated === null) {
        throw new TypeError('Valuation publication validation requires an exact projection.');
      }
      const actor = actorSchema.parse(input.actor);
      const custody = await dependencies.persistProjectionRelease({
        verification: authenticated.verification,
      });
      const occurredAt = await trustedNow(dependencies.client);
      const current = await dependencies.publicationRepository.load();
      const mutation = await dependencies.publicationRepository.apply({
        expectedRevision: current.revision,
        command: {
          action: 'validate',
          publicationId: authenticated.output.projectionManifest.content.publicationId,
          occurredAt,
          actor,
          evidenceId: custody.readback.receiptId,
          projectionManifestVerification: authenticated.verification,
        },
        projectionReleaseArtifact: custody.releaseArtifact,
      });
      return Object.freeze({ custody, mutation });
    },

    async authorize(input: AflTradeValuationPublicationAuthorizeInput) {
      const publicationId = aflTradeContentAddressedIdSchema('publication').parse(
        input.publicationId
      );
      const gateDecisionId = aflTradeContentAddressedIdSchema('gate-decision').parse(
        input.gateDecisionId
      );
      const actor = actorSchema.parse(input.actor);
      const occurredAt = await trustedNow(dependencies.client);
      const [storedGate, current] = await Promise.all([
        dependencies.gateRepository.load(),
        dependencies.publicationRepository.load(),
      ]);
      return dependencies.publicationRepository.apply({
        expectedRevision: current.revision,
        expectedEnvironment: dependencies.environment,
        command: {
          action: input.action,
          publicationId,
          occurredAt,
          actor,
          evidenceId: gateDecisionId,
          gateDecisionId,
          gateDecisionLedger: requireGateLedger(storedGate),
          environment: dependencies.environment,
        },
      });
    },

    async disposition(input: AflTradeValuationPublicationDispositionInput) {
      const publicationId = aflTradeContentAddressedIdSchema('publication').parse(
        input.publicationId
      );
      const actor = actorSchema.parse(input.actor);
      const evidenceId = evidenceIdSchema.parse(input.evidenceId);
      const reason = dispositionReasonSchema.parse(input.reason);
      const occurredAt = await trustedNow(dependencies.client);
      const current = await dependencies.publicationRepository.load();
      return dependencies.publicationRepository.apply({
        expectedRevision: current.revision,
        expectedEnvironment: dependencies.environment,
        command: {
          action: input.action,
          publicationId,
          occurredAt,
          actor,
          evidenceId,
          reason,
        },
      });
    },
  });
}

export function createPostgresAflTradeValuationPublicationCommandService(input: {
  client: AflOutcomeSqlClient;
  publicationRepository: AflTradePublicationRepository;
  gateRepository: Pick<AflTradeGateDecisionLedgerRepository, 'load'>;
  environment: AflTradeDecisionEnvironment;
  artifactRepository: AflTradeImmutableArtifactRepository;
}): AflTradeValuationPublicationCommandService {
  return createAflTradeValuationPublicationCommandService({
    client: input.client,
    publicationRepository: input.publicationRepository,
    gateRepository: input.gateRepository,
    environment: input.environment,
    persistProjectionRelease: (request) =>
      persistPostgresAflTradeProjectionRelease(request, {
        client: input.client,
        artifactRepository: input.artifactRepository,
      }),
  });
}
