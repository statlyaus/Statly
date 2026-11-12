import { resultStyle } from '@/components/scores/MatchupScore';

import { noLosersResultLabel, type NoLosersPlayerResult } from './noLosersDisplay';

/** BR-40: a letter badge plus visible text, so the state never depends on colour (NFR-8). */
export function NoLosersResultBadge({ result }: { result: NoLosersPlayerResult }) {
  const label = noLosersResultLabel(result);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-[color:var(--league-text-muted)]">
      <span
        aria-hidden="true"
        className={`inline-flex size-4 items-center justify-center rounded-sm text-[10px] font-bold ${resultStyle[label.tone].className}`}
      >
        {label.badge}
      </span>
      <span aria-hidden="true">{label.text}</span>
      <span className="sr-only">{label.srText}</span>
    </span>
  );
}
