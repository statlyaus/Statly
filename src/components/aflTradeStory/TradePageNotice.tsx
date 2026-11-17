import Link from 'next/link';

import type { AflTradePageModel } from './tradePageModel';

/**
 * The strip above every trade page. Private pages say so. The public pages say what the numbers are
 * and that open stints keep moving them, and point at the method page.
 */
export function TradePageNotice({ source }: { source: AflTradePageModel['source'] }) {
  return (
    <p className="mb-4 rounded-lg border border-(--ts-line) bg-(--ts-bg2) px-3 py-2 ts-body">
      {source.audience === 'public' ? (
        <>
          {source.label}. Values for players still at their club, and for picks marked *, will move.{' '}
          <Link href="/afl/trades/method" className="underline underline-offset-2">
            How this works
          </Link>
        </>
      ) : (
        <>
          <b>Private page.</b> Not for publication. {source.label}.
        </>
      )}
    </p>
  );
}
