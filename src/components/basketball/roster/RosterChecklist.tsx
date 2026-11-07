import { Check } from 'lucide-react';

import { badgeStyles } from '@/components/ui/controlStyles';

export interface RosterChecklistStep {
  title: string;
  /** Where things stand, such as "13 players" or "Not set". */
  detail: string;
  done: boolean;
  /** In-page anchor of the section that does this step. */
  href: string;
}

/**
 * The order that makes a profile useful: your team, this week's opponent, then everyone rostered
 * on other teams. Each step says Done or To do in words; the tick is extra.
 */
export function RosterChecklist({ steps }: { steps: RosterChecklistStep[] }) {
  return (
    <section aria-labelledby="bb-setup-steps" className="rounded-lg border border-border bg-card">
      <h2
        id="bb-setup-steps"
        className="border-b border-border px-4 py-2 text-sm font-semibold text-foreground"
      >
        Set up in three steps
      </h2>
      <ol className="grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
        {steps.map((step, index) => (
          <li key={step.href} className="flex min-w-0 items-start gap-3 px-4 py-3">
            <span
              aria-hidden="true"
              className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-bold tabular-nums ${
                step.done
                  ? 'border-result-win bg-result-win text-result-win-foreground'
                  : 'border-border text-foreground'
              }`}
            >
              {step.done ? <Check className="size-4" /> : index + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <a
                href={step.href}
                className="text-sm font-semibold text-foreground underline decoration-transparent underline-offset-4 hover:decoration-current focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="sr-only">Step {index + 1}: </span>
                {step.title}
              </a>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className={badgeStyles({ tone: step.done ? 'win' : 'neutral', size: 'xs' })}>
                  {step.done ? 'Done' : 'To do'}
                </span>
                {step.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
