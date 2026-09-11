import { z } from 'zod';

import {
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
} from '../artifacts/artifactReference';
import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type { AflTradeHpnPavMethodAuthority } from '../modeling/hpnPavCalculationService';
import { aflTradeHpnPavMethodSchema } from '../modeling/hpnPlayerApproximateValue';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';

/** Load an already registered method; registration and source admission remain separate operations. */
export function createLocalAflTradeHpnMethodAuthority(input: {
  readonly sql: AflOutcomeSqlClient;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
}): AflTradeHpnPavMethodAuthority {
  const maximumBytes = z.number().int().positive().parse(input.maximumArtifactBytes);
  const artifacts = input.artifactRepository;
  if (
    artifacts.artifactClass !== 'raw_source' ||
    !(
      artifacts.assurance === 'local_non_production_filesystem' ||
      (artifacts.assurance === 'durable_object_storage' &&
        artifacts.custodyProfile?.content.environment === 'non_production')
    )
  ) {
    throw new TypeError('Local HPN method loading requires non-production artifact custody.');
  }
  return {
    async loadExact(unparsedMethodId) {
      const methodId = aflTradeContentAddressedIdSchema('hpn-pav-method').parse(unparsedMethodId);
      const result = await input.sql.query<{ readonly method_json: unknown }>(
        `SELECT method.method_json FROM outcome_hpn_pav_method method
           JOIN outcome_artifact_custody artifact ON artifact.artifact_id=method.source_artifact_id
            AND artifact.environment='non_production'
          WHERE method.method_id=$1 AND method.environment='non_production'`,
        [methodId]
      );
      if (result.rows.length !== 1) {
        throw new TypeError('Registered non-production HPN method is unavailable.');
      }
      const method = aflTradeHpnPavMethodSchema.parse(result.rows[0]!.method_json);
      if (method.methodId !== methodId)
        throw new TypeError('Registered HPN method selection differs.');
      const source = method.content.sourceArtifact;
      if (source.byteLength > maximumBytes)
        throw new TypeError('Retained HPN method source exceeds its byte limit.');
      const retained = await artifacts.loadExact(source, maximumBytes);
      if (
        retained === null ||
        retained.bytes.byteLength > maximumBytes ||
        !doAflTradeArtifactRefsExactlyMatch(source, retained.reference) ||
        !doesAflTradeArtifactRefMatchBytes(source, retained.bytes, 'text/html')
      ) {
        throw new TypeError('Retained HPN method source does not match its registered authority.');
      }
      return { method, sourceBytes: retained.bytes };
    },
  };
}
