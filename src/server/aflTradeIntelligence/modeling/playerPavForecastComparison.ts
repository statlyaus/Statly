import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import { aflTradePlayerPavObservationSetSchema } from './playerPavObservationContracts';
import {
  playerPavForecastConfigurationSchema,
  preparePlayerPavResearchRows,
  type PlayerPavForecastCandidate,
  type PlayerPavResearchRow,
} from './playerPavForecastDesign';
import { fitPlayerPavForecast } from './playerPavForecastFit';
import {
  createPlayerPavResearchForecasts,
  evaluatePlayerPavResearchForecasts,
} from './playerPavForecastEvaluation';

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const usable = (row: PlayerPavResearchRow) =>
  row.target !== null && row.forecastUnavailable === null;

/** Research comparison only: neither a registered protocol nor a qualified model execution. */
export function compareAflTradePlayerPavForecasts(request: {
  observationSet: unknown;
  configuration: unknown;
}) {
  const set = aflTradePlayerPavObservationSetSchema.parse(request.observationSet);
  const configuration = playerPavForecastConfigurationSchema.parse(request.configuration);
  const rows = preparePlayerPavResearchRows(set, configuration);
  const train = rows.filter((row) => row.partition === 'train' && usable(row));
  const origins = [...new Set(train.map((row) => row.predictionSeason))];
  const folds = origins.flatMap((origin) => {
    const validation = train.filter((row) => row.predictionSeason === origin);
    const training = train.filter(
      (row) => row.predictionSeason < origin && row.labelAvailableAt < validation[0]!.cutoff
    );
    return training.length < configuration.minimumTrainingObservations
      ? []
      : [{ origin, training, validation }];
  });
  const candidates: PlayerPavForecastCandidate[] = [
    { kind: 'persistence', historySeasons: 1 },
    ...configuration.featureHistories.flatMap((historySeasons) =>
      configuration.shrinkagePseudoSeasons.map((pseudoSeasons) => ({
        kind: 'shrinkage' as const,
        historySeasons,
        pseudoSeasons,
      }))
    ),
    ...configuration.featureHistories.flatMap((historySeasons) =>
      configuration.ridgePenalties.map((penalty) => ({
        kind: 'ridge' as const,
        historySeasons,
        penalty,
      }))
    ),
  ];
  // Bound local research work explicitly; do not silently sample or truncate the admitted cohort.
  if (
    candidates.length * sum(folds.map((fold) => fold.training.length + fold.validation.length)) >
    2_000_000
  ) {
    throw new RangeError('PAV research tuning workload exceeds the supported comparison bound.');
  }
  const tuning = candidates.map((candidate) => ({
    candidate,
    candidateId: createAflTradeContentAddress('player-pav-research-candidate', candidate),
    meanAnnualSquaredError:
      folds.length < configuration.minimumTuningOrigins
        ? null
        : sum(
            folds.map((fold) => {
              const fitted = fitPlayerPavForecast(fold.training, candidate);
              return (
                sum(
                  fold.validation.map(
                    (row) =>
                      sum(
                        fitted
                          .predict(row)
                          .map((value, index) => (value - row.target![index]!) ** 2)
                      ) / 3
                  )
                ) / fold.validation.length
              );
            })
          ) / folds.length,
  }));
  if (
    tuning.some(
      (result) =>
        result.meanAnnualSquaredError !== null && !Number.isFinite(result.meanAnnualSquaredError)
    )
  ) {
    throw new RangeError('PAV tuning scores must remain finite.');
  }
  const cutoff = Math.min(
    ...rows.filter((row) => row.partition === 'calibration').map((row) => row.cutoff)
  );
  const training = train.filter((row) => row.labelAvailableAt < cutoff);
  const models = (['persistence', 'shrinkage', 'ridge'] as const).flatMap((kind) => {
    const selected = tuning
      .filter((result) => result.candidate.kind === kind && result.meanAnnualSquaredError !== null)
      .sort((left, right) => left.meanAnnualSquaredError! - right.meanAnnualSquaredError!)[0];
    if (!selected || training.length < configuration.minimumTrainingObservations) return [];
    const fitted = fitPlayerPavForecast(training, selected.candidate);
    const forecasts = createPlayerPavResearchForecasts(
      rows,
      fitted,
      selected.candidate.historySeasons,
      configuration
    );
    return [
      {
        kind,
        candidate: selected.candidate,
        candidateId: selected.candidateId,
        fittedModel: fitted.state,
        tuningOrigins: folds.map((fold) => fold.origin),
        trainingObservationIds: training.map((row) => row.observationId),
        forecasts,
        evaluation: evaluatePlayerPavResearchForecasts(rows, forecasts, configuration),
      },
    ];
  });
  const content = {
    schemaVersion: 'player-pav-forecast-comparison/v2' as const,
    environment: set.content.environment,
    methodId: set.content.policy.content.methodId,
    forecastOrigin: 'year_end' as const,
    admissionStatus: 'research_only_no_group_disjoint_admission_claim' as const,
    historicalSourceAvailability: 'not_established_by_calculation_timestamps_alone' as const,
    selectionCriterion: 'equal_origin_mean_annual_squared_error' as const,
    publicationEligible: false as const,
    qualificationEligible: false as const,
    tradePackageDistribution: 'unavailable_no_joint_evidence' as const,
    state:
      models.length === 0
        ? ('unavailable_insufficient_training_or_tuning_support' as const)
        : ('research_comparison' as const),
    observationSetId: set.observationSetId,
    configuration,
    models,
    tuning,
    folds: folds.map((fold) => ({
      origin: fold.origin,
      trainingObservationIds: fold.training.map((row) => row.observationId),
      validationObservationIds: fold.validation.map((row) => row.observationId),
    })),
    coverage: rows.map((row) => ({
      observationId: row.observationId,
      playerId: row.playerId,
      partition: row.partition,
      observedHistorySeasons: row.history.filter((value) => value !== null).length,
      outcomeUnavailable: row.outcomeUnavailable,
      forecastUnavailable: row.forecastUnavailable,
      scored:
        row.partition !== 'train' &&
        row.partition !== 'calibration' &&
        usable(row) &&
        models.length > 0,
    })),
  };
  return {
    comparisonId: createAflTradeContentAddress('player-pav-research-comparison', content),
    ...content,
  };
}
