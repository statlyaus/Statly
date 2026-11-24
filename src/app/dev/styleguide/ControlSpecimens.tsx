import { StatlyWordmark } from '@/components/brand/StatlyWordmark';
import { ClubSquare } from '@/components/ui/ClubSquare';
import {
  alertStyles,
  badgeStyles,
  buttonStyles,
  chipStyles,
  fieldLabelStyles,
  fieldStyles,
  floatingStyles,
  kbdStyles,
  menuItemStyles,
  tableStyles,
  textLinkStyles,
} from '@/components/ui/controlStyles';
import StatlyIcon, { type StatlyIconName } from '@/components/ui/StatlyIcon';

import { Section } from './Section';

const BUTTON_VARIANTS = ['primary', 'outline', 'ghost'] as const;
const BUTTON_SIZES = ['lg', 'md', 'sm', 'xs'] as const;
const BADGE_TONES = ['neutral', 'muted', 'brand', 'warning', 'win', 'loss', 'draw'] as const;
const BADGE_SIZES = ['xs', 'sm', 'md'] as const;
const ALERT_TONES = ['info', 'deadline', 'error', 'outage', 'success'] as const;

const CLUBS = [
  'Adelaide',
  'Brisbane',
  'Carlton',
  'Collingwood',
  'Essendon',
  'Fremantle',
  'Geelong',
  'Gold Coast',
  'GWS',
  'Hawthorn',
  'Melbourne',
  'North Melbourne',
  'Port Adelaide',
  'Richmond',
  'St Kilda',
  'Sydney',
  'West Coast',
  'Western Bulldogs',
];

// A record, so a new StatlyIconName fails typecheck until it is listed here.
const ICON_NAMES: Record<StatlyIconName, true> = {
  home: true,
  gauge: true,
  bolt: true,
  players: true,
  draft: true,
  basketball: true,
  tools: true,
  stopwatch: true,
  footy: true,
  trade: true,
  ladder: true,
  team: true,
  commissioner: true,
  help: true,
};
const ICONS = Object.keys(ICON_NAMES) as StatlyIconName[];

/** The control recipes in controlStyles.ts and the shared brand components, on the white ground. */
const SAMPLE_ROWS = [
  ['Geelong', 41, '+18.4'],
  ['GWS Giants', 37, '−6.1'],
  ['Hawthorn', 29, '+2.0'],
] as const;

export function ControlSpecimens() {
  return (
    <>
      <Section title="Buttons" note="buttonStyles. One primary per view; danger always confirms.">
        <div className="space-y-3">
          {BUTTON_VARIANTS.map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-3">
              {BUTTON_SIZES.map((size) => (
                <button key={size} type="button" className={buttonStyles({ variant, size })}>
                  {variant} {size}
                </button>
              ))}
            </div>
          ))}
          <div data-specimen="red" className="flex flex-wrap items-center gap-3">
            {BUTTON_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className={buttonStyles({ variant: 'danger', size })}
              >
                danger {size}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled className={buttonStyles({ variant: 'primary' })}>
              Submit pick
            </button>
            <span className="text-sm text-muted-foreground">Disabled: it is not your turn.</span>
            <a
              href="/dev/styleguide"
              aria-disabled="true"
              tabIndex={-1}
              className={buttonStyles({ variant: 'outline' })}
            >
              Link styled as a button
            </a>
          </div>
        </div>
      </Section>

      <Section title="Badges" note="badgeStyles: torn tape, always a word or letter.">
        <div className="flex flex-wrap items-center gap-3">
          {BADGE_TONES.map((tone) => (
            <span key={tone} className={badgeStyles({ tone })}>
              {tone === 'win' ? 'W' : tone === 'loss' ? 'L' : tone === 'draw' ? 'D' : tone}
            </span>
          ))}
          <span className={badgeStyles({ tone: 'brand', caps: false })}>Someone&apos;s words</span>
          {BADGE_SIZES.map((size) => (
            <span key={size} className={badgeStyles({ size })}>
              size {size}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Chips" note="chipStyles: sun when picked.">
        <div className="flex flex-wrap gap-3">
          <button type="button" aria-pressed="true" className={chipStyles({ picked: true })}>
            Picked
          </button>
          <button type="button" aria-pressed="false" className={chipStyles({ picked: false })}>
            Not picked
          </button>
        </div>
      </Section>

      <Section title="Fields" note="fieldStyles: white with a 2px ink edge on every ground.">
        <div className="grid max-w-xl gap-4">
          <label className={fieldLabelStyles}>
            Team name
            <input className={fieldStyles()} defaultValue="Footscray Flyers" />
          </label>
          <div className={fieldLabelStyles}>
            <label htmlFor="styleguide-bid">Bid</label>
            <input
              id="styleguide-bid"
              className={fieldStyles({ size: 'sm' })}
              defaultValue="-4"
              aria-invalid="true"
              aria-describedby="styleguide-bid-error"
            />
            <span id="styleguide-bid-error" role="alert" className="text-sm text-destructive-text">
              A bid is 0 or more.
            </span>
          </div>
          <label className={fieldLabelStyles}>
            Locked field
            <input className={fieldStyles()} disabled defaultValue="Set by the commissioner" />
          </label>
          <label className={fieldLabelStyles}>
            Message
            <textarea className={fieldStyles({ size: 'area' })} placeholder="Say something" />
          </label>
          <p className="text-sm">
            Press <kbd className={kbdStyles}>Enter</kbd> to send, or read the{' '}
            <a href="/dev/styleguide" className={textLinkStyles}>
              text link
            </a>
            .
          </p>
        </div>
      </Section>

      <Section
        title="Tables"
        note="tableStyles: hairline rules, no stripes, 44px rows, numbers right in tabular figures."
      >
        <div className={tableStyles.frame}>
          <table className={tableStyles.table}>
            <caption className="sr-only">Sample table</caption>
            <thead>
              <tr className={tableStyles.headRow}>
                <th scope="col" className={tableStyles.th}>
                  Club
                </th>
                <th scope="col" className={`${tableStyles.th} ${tableStyles.number}`}>
                  Trades
                </th>
                <th scope="col" className={`${tableStyles.th} ${tableStyles.number}`}>
                  Net PAV
                </th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_ROWS.map(([club, trades, net]) => (
                <tr key={club} className={tableStyles.row}>
                  <td className={tableStyles.td}>{club}</td>
                  <td className={`${tableStyles.td} ${tableStyles.number}`}>{trades}</td>
                  <td className={`${tableStyles.td} ${tableStyles.number}`}>{net}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Alerts" note="alertStyles: a ground, never a stripe. Text stays ink.">
        <div className="grid gap-3 sm:grid-cols-2">
          {ALERT_TONES.map((tone) => (
            <p key={tone} className={`p-4 text-sm ${alertStyles({ tone })}`}>
              <b className="font-display">{tone}.</b> The alert says what happened in words.
            </p>
          ))}
        </div>
      </Section>

      <Section title="Floating" note="floatingStyles and menuItemStyles: cut edge, hard shadow.">
        <div className="flex flex-wrap items-start gap-8">
          <ul className={`w-56 py-2 ${floatingStyles({ tone: 'light' })}`}>
            <li>
              <button type="button" aria-current="true" className={menuItemStyles()}>
                Current league
              </button>
            </li>
            <li>
              <button type="button" className={menuItemStyles()}>
                Another league
              </button>
            </li>
          </ul>
          <p className={`max-w-56 p-3 text-sm ${floatingStyles({ tone: 'ink' })}`}>
            A tooltip or toast is ink with a cobalt shadow.
          </p>
        </div>
      </Section>

      <Section title="Club squares" note="ClubSquare: the only place club colour appears.">
        <ul className="grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
          {CLUBS.map((club) => (
            <li key={club}>
              <ClubSquare club={club} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Icons" note="StatlyIcon: labels things, never carries meaning alone.">
        <ul className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-7">
          {ICONS.map((name) => (
            <li key={name} className="flex items-center gap-2">
              <StatlyIcon name={name} className="size-6" />
              {name}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Wordmark" note="StatlyWordmark: the one logo source.">
        <div className="flex flex-wrap items-center gap-8">
          <div className="bg-brand-bar px-6 py-4 text-brand-bar-foreground">
            <StatlyWordmark />
          </div>
          {/* The ball overhangs the word; the padding keeps it inside the 390px page. */}
          <div className="pr-16">
            <StatlyWordmark size="lockup" />
          </div>
        </div>
      </Section>
    </>
  );
}
