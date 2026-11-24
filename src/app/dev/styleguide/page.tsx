import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { buttonStyles, resultTone, textLinkStyles } from '@/components/ui/controlStyles';
import { isDevelopmentToolsEnabled } from '@/server/developmentTools';

import { ControlSpecimens } from './ControlSpecimens';
import { Section } from './Section';
import { TokenValue } from './TokenValue';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Style guide | Statly',
  robots: { index: false, follow: false },
};

// Every colour token on `:root` in src/index.css (tests/unit/styleGuidePage.test.ts keeps the lists
// complete). Swatch classes are spelled out so Tailwind sees them. `red` marks the swatches the brand audit
// would read as a red fill: the e2e test skips them by `data-specimen="red"` and checks it did.
type Swatch = { name: string; swatch: string; red?: boolean };

const PRIMITIVES: Swatch[] = [
  { name: '--brand-cobalt', swatch: 'bg-(--brand-cobalt)' },
  { name: '--brand-cobalt-deep', swatch: 'bg-(--brand-cobalt-deep)' },
  { name: '--brand-tint', swatch: 'bg-(--brand-tint)' },
  { name: '--brand-sun', swatch: 'bg-(--brand-sun)' },
  { name: '--brand-ink', swatch: 'bg-(--brand-ink)' },
  { name: '--brand-stone', swatch: 'bg-(--brand-stone)' },
  { name: '--brand-secondary-text', swatch: 'bg-(--brand-secondary-text)' },
  { name: '--brand-hairline', swatch: 'bg-(--brand-hairline)' },
  { name: '--brand-red', swatch: 'bg-(--brand-red)', red: true },
  { name: '--brand-paper', swatch: 'bg-(--brand-paper)' },
  { name: '--brand-paper-deep', swatch: 'bg-(--brand-paper-deep)' },
];

const ROLES: Swatch[] = [
  { name: '--background', swatch: 'bg-background' },
  { name: '--foreground', swatch: 'bg-foreground' },
  { name: '--card', swatch: 'bg-card' },
  { name: '--card-foreground', swatch: 'bg-card-foreground' },
  { name: '--popover', swatch: 'bg-popover' },
  { name: '--popover-foreground', swatch: 'bg-popover-foreground' },
  { name: '--primary', swatch: 'bg-primary' },
  { name: '--primary-foreground', swatch: 'bg-primary-foreground' },
  { name: '--secondary', swatch: 'bg-secondary' },
  { name: '--secondary-foreground', swatch: 'bg-secondary-foreground' },
  { name: '--muted', swatch: 'bg-muted' },
  { name: '--muted-foreground', swatch: 'bg-muted-foreground' },
  { name: '--accent', swatch: 'bg-accent' },
  { name: '--accent-foreground', swatch: 'bg-accent-foreground' },
  { name: '--destructive', swatch: 'bg-destructive', red: true },
  { name: '--destructive-foreground', swatch: 'bg-destructive-foreground' },
  { name: '--destructive-text', swatch: 'bg-destructive-text', red: true },
  { name: '--destructive-soft', swatch: 'bg-destructive-soft' },
  { name: '--success', swatch: 'bg-success' },
  { name: '--success-soft', swatch: 'bg-success-soft' },
  { name: '--warning', swatch: 'bg-warning' },
  { name: '--warning-foreground', swatch: 'bg-warning-foreground' },
  { name: '--warning-text', swatch: 'bg-warning-text' },
  { name: '--warning-soft', swatch: 'bg-warning-soft' },
  { name: '--result-win', swatch: 'bg-result-win' },
  { name: '--result-win-foreground', swatch: 'bg-result-win-foreground' },
  { name: '--result-loss', swatch: 'bg-result-loss' },
  { name: '--result-loss-foreground', swatch: 'bg-result-loss-foreground' },
  { name: '--status-live', swatch: 'bg-status-live', red: true },
  { name: '--status-live-foreground', swatch: 'bg-status-live-foreground' },
  { name: '--result-draw', swatch: 'bg-result-draw' },
  { name: '--result-draw-foreground', swatch: 'bg-result-draw-foreground' },
  { name: '--brand-bar', swatch: 'bg-brand-bar' },
  { name: '--brand-bar-foreground', swatch: 'bg-brand-bar-foreground' },
  { name: '--brand-bar-hover', swatch: 'bg-brand-bar-hover' },
  { name: '--overlay', swatch: 'bg-overlay' },
  { name: '--border', swatch: 'bg-border' },
  { name: '--input', swatch: 'bg-input' },
  { name: '--field', swatch: 'bg-field' },
  { name: '--field-foreground', swatch: 'bg-field-foreground' },
  { name: '--field-placeholder', swatch: 'bg-field-placeholder' },
  { name: '--ring', swatch: 'bg-ring' },
];

const GROUNDS = [
  'ground-white',
  'ground-stone',
  'ground-tint',
  'ground-cobalt',
  'ground-ink',
  'ground-sun',
] as const;

/**
 * The living style guide (docs/product/style-guide.md, phase 6): every token, ground and control
 * recipe, rendered from the same sources the app uses. Development only: it renders the not-found page
 * in production or without STATLY_ENABLE_DEV_TOOLS=true. The brand audit and axe run on it in
 * tests/e2e/styleguide.test.ts.
 */
export default function StyleGuidePage() {
  if (!isDevelopmentToolsEnabled()) notFound();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-4xl font-black">Style guide</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Tokens, grounds and control recipes from src/index.css and controlStyles.ts. The rules are
        in docs/product/style-guide.md.
      </p>

      <Section title="Colour primitives" note="Raw values. Components never read these.">
        <SwatchGrid swatches={PRIMITIVES} />
      </Section>

      <Section title="Colour roles" note="The names components use, on the white ground.">
        <SwatchGrid swatches={ROLES} />
      </Section>

      <Section title="Grounds" note="A ground sets the roles, so the same markup is right on each.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GROUNDS.map((ground) => (
            <GroundSample key={ground} className={ground} label={ground} />
          ))}
          <div data-surface="paper">
            <GroundSample className="" label='data-surface="paper"' />
          </div>
        </div>
      </Section>

      <Section
        title="Type"
        note="Geist for display and UI, Saira for reading, Caveat for one note."
      >
        <div className="space-y-4">
          <p className="font-display text-5xl leading-[0.9] font-black tracking-[-0.05em]">
            Display line
          </p>
          <p className="font-display text-[28px] font-black">6–3</p>
          <p className="font-display text-base font-bold">UI: buttons, labels, tabs and names</p>
          <p className="font-display text-[11px] font-bold tracking-[0.1em] uppercase">Label</p>
          <p className="max-w-prose">
            Reading text is Saira. Sentences, captions, alerts and table numbers use it, and numbers
            line up in columns: 1,204 and 98.6.
          </p>
          <p className="font-hand text-[22px] font-bold">One hand note per view</p>
        </div>
      </Section>

      <Section title="Shape and elevation" note="Square page, hand-cut controls, one hard shadow.">
        <div className="flex flex-wrap items-start gap-8">
          <div className="h-24 w-40 border border-border bg-card p-3 text-sm">Square tile</div>
          <div className="h-24 w-40 rounded-cut border-2 border-input bg-field p-3 text-sm">
            rounded-cut
          </div>
          <div className="ground-white h-24 w-40 rounded-cut-float border-[2.5px] border-foreground p-3 text-sm shadow-hard">
            rounded-cut-float, shadow-hard
          </div>
          <div className="ground-ink h-24 w-40 rounded-cut-float p-3 text-sm shadow-hard-cobalt">
            shadow-hard-cobalt
          </div>
        </div>
      </Section>

      <ControlSpecimens />
    </main>
  );
}

function SwatchGrid({ swatches }: { swatches: Swatch[] }) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {swatches.map(({ name, swatch, red }) => (
        <li key={name} className="flex items-center gap-3">
          <span
            aria-hidden="true"
            data-specimen={red ? 'red' : undefined}
            className={`size-12 flex-none border border-foreground ${swatch}`}
          />
          <span className="flex min-w-0 flex-col">
            <code className="truncate font-sans text-sm font-semibold">{name}</code>
            <TokenValue name={name} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function GroundSample({ className, label }: { className: string; label: string }) {
  return (
    <div className={`p-4 ${className}`}>
      <h3 className="font-display text-lg font-extrabold">{label}</h3>
      <p className="mt-1 text-sm">Body text on this ground.</p>
      <p className="text-sm text-muted-foreground">Secondary text on this ground.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={buttonStyles({ variant: 'primary' })}>
          Save lineup
        </button>
        <button type="button" className={buttonStyles({ variant: 'outline' })}>
          Cancel
        </button>
        <a href="/dev/styleguide" className={`text-sm ${textLinkStyles}`}>
          Text link
        </a>
      </div>
      <div role="group" aria-label="Results" className="mt-3 flex gap-1">
        <span className={`px-2 font-display font-extrabold ${resultTone.win}`}>W</span>
        <span className={`px-2 font-display font-extrabold ${resultTone.loss}`}>L</span>
        <span className={`px-2 font-display font-extrabold ${resultTone.draw}`}>D</span>
      </div>
    </div>
  );
}
