import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  ingestAuthorizedAflTradeFitzRoyProviderSeason,
  type AflTradeFitzRoyProviderIngestionDependencies,
} from '../source/fitzRoyProviderIngestion';
import {
  createAflTradeFitzRoyInvocation,
  parseAflTradeFitzRoyCaptureRequest,
} from '../source/fitzRoyCaptureContracts';
import { requireAflTradePrivateValuationHpnScopePolicy } from '../valuation/privateValuationHpnScopePolicy';
import type {
  AflTradePrivateValuationHpnPreparationDependencies,
  AflTradePrivateValuationHpnSourceAuthority,
} from '../valuation/postgresPrivateValuationHpnPreparation';

type CaptureSource = AflTradePrivateValuationHpnPreparationDependencies['captureSource'];
type SourceRole = Parameters<CaptureSource>[0]['sourceRole'];
type SourceLane = Readonly<{
  authority: AflTradePrivateValuationHpnSourceAuthority;
  dependencies: AflTradeFitzRoyProviderIngestionDependencies;
}>;

/**
 * Trusted runtime selects reviewed source lanes and their policy-bound execution dependencies.
 * The HPN coordinator authenticates dispatch claims; this adapter grants no source approval.
 */
export function createLocalAflTradePrivateValuationHpnCapture(input: {
  readonly scopeKey: string;
  readonly sources: Readonly<Partial<Record<SourceRole, SourceLane>>>;
}): CaptureSource {
  const scope = requireAflTradePrivateValuationHpnScopePolicy(input.scopeKey);
  const sources = new Map(
    Object.entries(input.sources).map(([role, lane]) => [
      role,
      { dependencies: lane.dependencies, authorityJson: canonicalizeAflTradeJson(lane.authority) },
    ])
  );
  return async (request) => {
    const lane = sources.get(request.sourceRole);
    if (lane === undefined) throw new TypeError('No exact HPN capture source lane is configured.');
    if (
      canonicalizeAflTradeJson({ capture: request.capture, fieldMap: request.fieldMap }) !==
      lane.authorityJson
    ) {
      throw new TypeError('HPN source differs from its exact configured authority.');
    }
    const capture = parseAflTradeFitzRoyCaptureRequest(request.capture.captureRequest);
    const gate = request.capture.gateRequest;
    if (
      gate.environment !== 'non_production' ||
      gate.competition !== scope.competition ||
      gate.season !== scope.seasonYear ||
      capture.competition !== scope.competition ||
      capture.authorizationSeason !== scope.seasonYear ||
      request.fieldMap.competition !== scope.competition ||
      request.fieldMap.validFromSeason > scope.seasonYear ||
      request.fieldMap.validThroughSeason < scope.seasonYear
    ) {
      throw new TypeError('HPN capture source does not match its configured local scope.');
    }
    const invocation = createAflTradeFitzRoyInvocation(capture);
    const observationKind =
      request.sourceRole === 'hpn_completed_results' ? 'match_universe' : 'player_stat';
    if (
      request.fieldMap.observationKind !== observationKind ||
      request.fieldMap.capabilityId !== invocation.capabilityId ||
      gate.capabilityId !== invocation.capabilityId ||
      request.capture.sourceRights.content.provider !== invocation.provider
    ) {
      throw new TypeError('HPN source role, provider, capability, and field map do not match.');
    }
    const result = await ingestAuthorizedAflTradeFitzRoyProviderSeason(
      {
        capture: request.capture,
        fieldMap: request.fieldMap,
        fieldMapId: request.fieldMap.mapId,
        effectiveAt: lane.dependencies.clock.now(),
      },
      lane.dependencies
    );
    return { normalizationRunId: result.staging.normalization.normalizationRunId };
  };
}
