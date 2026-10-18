import { HPN_DPVC_V3_LAST_SUPPORTED_PICK, hpnDpv3ValueForPick } from './hpnPickValueBenchmark';
import type { AflTradePlayerSeasonGames } from './playerSeasonGames';
import {
  AFL_TRADE_VALUE_LINE_FIT_RULES,
  aflTradeValueLineBand,
  aflTradeValueLinePickValue,
  aflTradeValueLinePoint,
  aflTradeValueLineStint,
  fitAflTradeValueLine,
  indexAflTradeValueLineRows,
  type AflTradeValueLineDraftee,
  type AflTradeValueLineFit,
} from './valueLineFit';

/**
 * The out-of-sample back-test of the value-line fit (#789, spec "Fitting and validation"). The latest
 * classes are held out whole. For each held-out class and checkpoint (the draft, after year 1, after
 * year 3), the parameters are fitted on the training classes from seasons up to that checkpoint only,
 * and the class's value line there is compared with the PAV its first stints produced through the
 * read's last season. The model's line is cut at that season too, so both sides cover the same seasons.
 * HPN DPVC v3.0, the old at-trade projection, is compared at the draft; it is a whole-career value and
 * is not cut.
 */

export const AFL_TRADE_VALUE_LINE_BACKTEST_CHECKPOINTS = [0, 1, 3] as const;

export interface AflTradeValueLineErrorSummary {
  selections: number;
  predicted: number;
  actual: number;
  /** Mean of predicted − actual per selection. */
  bias: number;
  meanAbsoluteError: number;
  rootMeanSquaredError: number;
}

export interface AflTradeValueLineBacktest {
  trainingDraftYears: { from: number; through: number };
  heldOutDraftYears: readonly number[];
  actualThroughSeason: number;
  /** The parameters each checkpoint's fit produced, with its fit window. */
  fits: readonly { draftYear: number; checkpoint: number; fit: AflTradeValueLineFit }[];
  model: readonly {
    checkpoint: number;
    range: string;
    summary: AflTradeValueLineErrorSummary;
  }[];
  modelByClass: readonly {
    checkpoint: number;
    draftYear: number;
    summary: AflTradeValueLineErrorSummary;
  }[];
  /** DPVC v3.0 at the draft, for selections 1 to 90 (the range HPN states it for). */
  dpvc: readonly { range: string; summary: AflTradeValueLineErrorSummary }[];
  /** The model at the draft over the same selections DPVC covers. */
  modelOnDpvcSelections: readonly { range: string; summary: AflTradeValueLineErrorSummary }[];
}

const summarize = (rows: readonly { predicted: number; actual: number }[]) => {
  const n = rows.length;
  const errors = rows.map(({ predicted, actual }) => predicted - actual);
  const mean = (values: number[]) => (n === 0 ? 0 : values.reduce((a, b) => a + b, 0) / n);
  return {
    selections: n,
    predicted: rows.reduce((sum, row) => sum + row.predicted, 0),
    actual: rows.reduce((sum, row) => sum + row.actual, 0),
    bias: mean(errors),
    meanAbsoluteError: mean(errors.map(Math.abs)),
    rootMeanSquaredError: Math.sqrt(mean(errors.map((e) => e * e))),
  };
};

const RANGES = ['all', ...AFL_TRADE_VALUE_LINE_FIT_RULES.bands.map(({ id }) => id)];
const inRange = (range: string, slot: number) =>
  range === 'all' || aflTradeValueLineBand(slot) === range;

export function backtestAflTradeValueLine(input: {
  model: AflTradePlayerSeasonGames;
  draftees: readonly AflTradeValueLineDraftee[];
  trainingDraftYears: { from: number; through: number };
  heldOutDraftYears: readonly number[];
  actualThroughSeason: number;
}): AflTradeValueLineBacktest {
  const { trainingDraftYears: training, heldOutDraftYears, actualThroughSeason } = input;
  if (heldOutDraftYears.some((year) => year >= training.from && year <= training.through))
    throw new Error('A held-out class may not also be a training class.');
  const rowsByPlayer = indexAflTradeValueLineRows(input.model);
  const trainingDraftees = input.draftees.filter(
    ({ draftYear }) => draftYear >= training.from && draftYear <= training.through
  );
  const fits: { draftYear: number; checkpoint: number; fit: AflTradeValueLineFit }[] = [];
  const rows: {
    draftYear: number;
    checkpoint: number;
    slot: number;
    predicted: number;
    actual: number;
  }[] = [];
  for (const draftYear of heldOutDraftYears) {
    const held = input.draftees.filter((draftee) => draftee.draftYear === draftYear);
    if (held.length === 0) throw new Error(`Held-out class ${draftYear} has no selection.`);
    const actual = new Map(
      held.map((draftee) => {
        const stint = aflTradeValueLineStint(
          input.model,
          rowsByPlayer,
          draftee,
          actualThroughSeason
        );
        return [draftee.selectionId, stint.seasons.reduce((sum, s) => sum + s.pav, 0)];
      })
    );
    for (const checkpoint of AFL_TRADE_VALUE_LINE_BACKTEST_CHECKPOINTS) {
      const asOfSeason = draftYear + checkpoint;
      if (asOfSeason > actualThroughSeason) continue;
      const fit = fitAflTradeValueLine({
        model: input.model,
        draftees: trainingDraftees,
        asOfSeason,
        rowsByPlayer,
      });
      fits.push({ draftYear, checkpoint, fit });
      for (const draftee of held) {
        const stint = aflTradeValueLineStint(input.model, rowsByPlayer, draftee, asOfSeason);
        const point = aflTradeValueLinePoint(fit, stint, actualThroughSeason - draftYear);
        rows.push({
          draftYear,
          checkpoint,
          slot: draftee.selectionNumber,
          predicted: point.value,
          actual: actual.get(draftee.selectionId)!,
        });
      }
    }
  }
  const atDraft = rows.filter(({ checkpoint }) => checkpoint === 0);
  const dpvcRows = atDraft.filter(({ slot }) => slot <= HPN_DPVC_V3_LAST_SUPPORTED_PICK);
  return {
    trainingDraftYears: training,
    heldOutDraftYears: [...heldOutDraftYears],
    actualThroughSeason,
    fits,
    model: AFL_TRADE_VALUE_LINE_BACKTEST_CHECKPOINTS.flatMap((checkpoint) =>
      RANGES.map((range) => ({
        checkpoint,
        range,
        summary: summarize(
          rows.filter((row) => row.checkpoint === checkpoint && inRange(range, row.slot))
        ),
      }))
    ),
    modelByClass: AFL_TRADE_VALUE_LINE_BACKTEST_CHECKPOINTS.flatMap((checkpoint) =>
      heldOutDraftYears.map((draftYear) => ({
        checkpoint,
        draftYear,
        summary: summarize(
          rows.filter((row) => row.checkpoint === checkpoint && row.draftYear === draftYear)
        ),
      }))
    ),
    dpvc: RANGES.map((range) => ({
      range,
      summary: summarize(
        dpvcRows
          .filter((row) => inRange(range, row.slot))
          .map((row) => ({ predicted: hpnDpv3ValueForPick(row.slot), actual: row.actual }))
      ),
    })),
    modelOnDpvcSelections: RANGES.map((range) => ({
      range,
      summary: summarize(dpvcRows.filter((row) => inRange(range, row.slot))),
    })),
  };
}

/** The pick curve for publication, with DPVC v3.0 beside it where HPN states it. */
export function aflTradeValueLinePickCurve(fit: AflTradeValueLineFit, throughSlot: number) {
  return Array.from({ length: throughSlot }, (_, index) => {
    const slot = index + 1;
    return {
      slot,
      firstStintPav: aflTradeValueLinePickValue(fit, slot),
      dpvcV3: slot <= HPN_DPVC_V3_LAST_SUPPORTED_PICK ? hpnDpv3ValueForPick(slot) : null,
    };
  });
}
