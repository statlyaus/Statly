import type { TradeEvaluation, TradeVerdict } from '@/lib/basketball/trade';
import { badgeStyles } from '@/components/ui/controlStyles';
import { getBasketballCategory } from '@/types/basketball';

import { formatSigned } from '../analysis/format';

const VERDICT: Record<TradeVerdict, { word: string; tone: 'win' | 'loss' | 'draw' }> = {
  GAIN: { word: 'Gain', tone: 'win' },
  LOSS: { word: 'Loss', tone: 'loss' },
  EVEN: { word: 'Even', tone: 'draw' },
};

/** Per-category z of what I give and get, the net and a GAIN/LOSS/EVEN word for each. */
export function TradeResult({ evaluation }: { evaluation: TradeEvaluation }) {
  const { gains, losses, evens } = evaluation.summary;
  return (
    <section aria-label="Trade result" className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">Net season value for you</p>
        <p
          className={`font-display text-3xl font-bold tabular-nums ${
            evaluation.totalNet >= 0.25
              ? 'text-result-win'
              : evaluation.totalNet <= -0.25
                ? 'text-result-loss'
                : 'text-foreground'
          }`}
        >
          {formatSigned(evaluation.totalNet)}
        </p>
        <p className="mt-1 text-sm text-foreground">
          {gains} {gains === 1 ? 'gain' : 'gains'}, {losses} {losses === 1 ? 'loss' : 'losses'},{' '}
          {evens} even
          {evaluation.categories.some((category) => category.punted) ? ' (punts left out)' : ''}.
        </p>
      </div>
      <div
        role="region"
        aria-label="Trade by category"
        className="overflow-x-auto rounded-lg border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <table className="w-full min-w-[30rem] table-fixed text-sm">
          <caption className="sr-only">
            Each category: the season z-scores you give and get, the net, and whether the trade
            gains, loses or is even there.
          </caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="w-24 px-3 py-2 text-left font-semibold">
                Category
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                You give
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                You get
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Net
              </th>
              <th scope="col" className="w-28 px-3 py-2 text-left font-semibold">
                Verdict
              </th>
            </tr>
          </thead>
          <tbody>
            {evaluation.categories.map((row) => {
              const verdict = VERDICT[row.verdict];
              return (
                <tr
                  key={row.category}
                  className={`h-12 border-b border-border ${row.punted ? 'text-muted-foreground' : 'text-foreground'}`}
                >
                  <th scope="row" className="px-3 text-left font-semibold">
                    {getBasketballCategory(row.category).shortLabel}
                  </th>
                  <td className="px-2 text-right tabular-nums">{formatSigned(row.give)}</td>
                  <td className="px-2 text-right tabular-nums">{formatSigned(row.get)}</td>
                  <td className="px-2 text-right font-semibold tabular-nums">
                    {formatSigned(row.net)}
                  </td>
                  <td className="px-3">
                    {row.punted ? (
                      <span className={badgeStyles({ tone: 'muted', size: 'xs' })}>Punted</span>
                    ) : (
                      <span className={badgeStyles({ tone: verdict.tone, size: 'xs' })}>
                        {verdict.word}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="h-12 text-foreground">
              <th scope="row" className="px-3 text-left font-semibold" colSpan={3}>
                Total, categories you count
              </th>
              <td className="px-2 text-right font-display text-base font-bold tabular-nums">
                {formatSigned(evaluation.totalNet)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
