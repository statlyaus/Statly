import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Class recipes for plain controls built on Statly's semantic tokens: the Marker controls in
 * docs/product/style-guide.md ("Shape", "Focus", "Motion", "Components"). Buttons and fields have
 * the shared hand-cut edge (`rounded-cut`) and an ink edge; badges are torn tape (`tape`). Focus is
 * a 3px dashed outline in the ground's focus colour. Primary follows the ground (cobalt on light
 * grounds, sun on cobalt and ink); a field is white with ink text on every ground.
 *
 * cva does not merge classes, so a border width lives only in the size variants and a border colour
 * only in the style variants; nothing in a base string is overridden by a variant.
 */

const focusOutline =
  'focus-visible:outline-[3px] focus-visible:outline-dashed focus-visible:outline-ring focus-visible:outline-offset-4';

// Disabled controls are dashed and muted, with no tilt. `aria-disabled` covers links styled as
// buttons, which cannot take `disabled`.
const buttonDisabled =
  'disabled:cursor-not-allowed disabled:border-dashed disabled:border-muted-foreground disabled:bg-transparent disabled:text-muted-foreground aria-disabled:cursor-not-allowed aria-disabled:border-dashed aria-disabled:border-muted-foreground aria-disabled:bg-transparent aria-disabled:text-muted-foreground';

// Hover tilts 1.5° and grows 3%; pressing squashes to 95%. Only with motion allowed, and never on a
// disabled control.
const pressable = 'motion-safe:not-disabled:not-aria-disabled:active:scale-95';
const tilt =
  'motion-safe:not-disabled:not-aria-disabled:hover:-rotate-[1.5deg] motion-safe:not-disabled:not-aria-disabled:hover:scale-[1.03]';

export const buttonStyles = cva(
  `inline-flex items-center justify-center gap-2 rounded-cut font-display font-extrabold transition ${focusOutline} ${pressable} ${buttonDisabled}`,
  {
    variants: {
      variant: {
        primary: `border-foreground bg-primary text-primary-foreground hover:bg-primary/90 ${tilt}`,
        outline: `border-foreground bg-background text-foreground hover:bg-muted ${tilt}`,
        // No tilt: the ghost is an underlined word that gains a quiet fill on hover.
        ghost:
          'border-transparent bg-transparent text-foreground underline decoration-2 underline-offset-[5px] hover:bg-muted',
        danger: `border-foreground bg-destructive text-destructive-foreground hover:bg-destructive/90 ${tilt}`,
      },
      size: {
        lg: 'min-h-12 border-[2.5px] text-base',
        md: 'min-h-11 border-[2.5px] text-sm',
        sm: 'min-h-8 border-2 text-[13px]',
        xs: 'min-h-7 border-2 text-xs',
      },
    },
    // Side padding depends on both axes (the ghost is tighter), so it lives here rather than in
    // a size variant that the ghost would have to override.
    compoundVariants: [
      { variant: ['primary', 'outline', 'danger'], size: ['lg', 'md'], class: 'px-6' },
      { variant: ['primary', 'outline', 'danger'], size: 'sm', class: 'px-4' },
      { variant: ['primary', 'outline', 'danger'], size: 'xs', class: 'px-2' },
      { variant: 'ghost', size: ['lg', 'md', 'sm'], class: 'px-3' },
      { variant: 'ghost', size: 'xs', class: 'px-2' },
    ],
    defaultVariants: { variant: 'outline', size: 'md' },
  }
);

/**
 * Match results (style guide "Owner decisions"): win solid (cobalt on light grounds, white on cobalt
 * and ink), loss a white chip with a 2px ink edge, draw stone. Every result mark also shows W, L or D.
 * The only place the result utilities are spelled, so error and success never ride on them.
 */
export const resultTone = {
  win: 'bg-result-win text-result-win-foreground',
  loss: 'bg-result-loss text-result-loss-foreground shadow-[inset_0_0_0_2px_currentColor]',
  draw: 'bg-result-draw text-result-draw-foreground',
} as const;

/**
 * Result fills alone, for bar segments; the bar's ink container and 1px gaps give the white loss its
 * edge. Bars sit only on white and tint, where designContrast.test.ts keeps the three fills apart.
 */
export const resultFill = {
  win: 'bg-result-win',
  loss: 'bg-result-loss',
  draw: 'bg-result-draw',
} as const;

export const badgeStyles = cva(
  'tape inline-flex items-center gap-1 whitespace-nowrap font-display text-[11px] font-extrabold',
  {
    variants: {
      tone: {
        // Quiet tape keeps ink text on its light fill on every ground.
        neutral: 'bg-muted text-field-foreground',
        muted: 'bg-muted text-field-foreground',
        brand: 'bg-secondary text-secondary-foreground',
        // Results: see resultTone.
        win: `min-w-7 justify-center ${resultTone.win}`,
        loss: `min-w-7 justify-center ${resultTone.loss}`,
        draw: `min-w-7 justify-center ${resultTone.draw}`,
        warning: 'bg-warning text-warning-foreground',
      },
      size: {
        xs: 'px-1.5 leading-5',
        sm: 'px-2 leading-5',
        md: 'px-2.5 py-0.5',
      },
      // Labels are uppercase; names, queries and other people's words keep their own case.
      caps: {
        true: 'uppercase tracking-[0.06em]',
        false: '',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'sm', caps: true },
  }
);

/**
 * Filter and choice chips (style guide, "Chips and segmented controls"): the hand-cut edge with a 2px
 * ink line, a quiet fill on hover, and sun with ink text when picked. 44px tall for phones.
 */
export const chipStyles = cva(
  `inline-flex min-h-11 items-center gap-2 rounded-cut border-2 border-foreground px-4 font-display text-sm font-bold transition ${focusOutline}`,
  {
    variants: {
      picked: {
        true: 'bg-warning text-warning-foreground',
        false: 'bg-card text-foreground hover:bg-muted',
      },
    },
    defaultVariants: { picked: false },
  }
);

/**
 * Alerts (style guide, "Alerts"): a square ground, never a stripe or a tinted wash. Info is tint, a
 * deadline is sun, an error is white with a red outline, an outage is stone; success is white with
 * a hairline and says so in words. Text stays ink on every tone. Layout is the caller's.
 */
export const alertStyles = cva('text-foreground', {
  variants: {
    tone: {
      info: 'ground-tint',
      deadline: 'ground-sun',
      error: 'ground-white border-2 border-destructive',
      outage: 'ground-stone',
      success: 'ground-white border border-border',
    },
  },
  defaultVariants: { tone: 'info' },
});

export const fieldStyles = cva(
  `w-full rounded-cut border-2 border-input bg-field px-3 text-sm text-field-foreground transition placeholder:text-field-placeholder ${focusOutline} disabled:cursor-not-allowed disabled:border-dashed disabled:border-field-placeholder disabled:bg-muted disabled:text-field-placeholder`,
  {
    variants: { size: { md: 'h-11', sm: 'h-9', area: 'min-h-24 py-2' } },
    defaultVariants: { size: 'md' },
  }
);

export const fieldLabelStyles = 'flex flex-col gap-1 text-sm font-medium text-foreground';

export const kbdStyles =
  'rounded-sm border border-border bg-muted px-1 font-sans text-[11px] font-semibold text-foreground';

export const textLinkStyles = `font-semibold text-foreground underline decoration-transparent underline-offset-4 hover:decoration-current ${focusOutline}`;

// Floating things (menus, dialogs, sheets, popovers, toasts, tooltips) share the floating cut and
// one hard shadow. Light ones are white with a 2.5px ink edge and an ink shadow; ink ones (toasts,
// tooltips) have no edge and a cobalt shadow. The ground class sets the roles inside the panel, so a
// portalled panel reads right wherever it lands.
export const floatingStyles = cva('rounded-cut-float', {
  variants: {
    tone: {
      light: 'ground-white border-[2.5px] border-foreground shadow-hard',
      ink: 'ground-ink shadow-hard-cobalt',
    },
  },
  defaultVariants: { tone: 'light' },
});

// A row in a menu, listbox or command list. The current value gets the sun highlighter
// (`aria-current` or Headless UI's `data-selected`); the pointer or keyboard position gets a quiet
// fill and an inset dashed outline, because the fill alone is 1.05:1 on white. Rows that never take
// DOM focus say where the position is: Headless UI sets `data-focus` (the default); a combobox
// option sets `aria-selected`, which Headless UI uses for the current value instead, hence the
// variant.
export const menuItemStyles = cva(
  `flex min-h-11 w-full items-center gap-3 px-3 text-left font-display text-sm font-semibold text-foreground transition-colors hover:bg-muted ${focusOutline} aria-[current=true]:highlighter data-selected:highlighter`,
  {
    variants: {
      position: {
        'data-focus':
          'data-focus:bg-muted data-focus:outline-2 data-focus:-outline-offset-2 data-focus:outline-dashed data-focus:outline-ring',
        'aria-selected':
          'aria-selected:bg-muted aria-selected:outline-2 aria-selected:-outline-offset-2 aria-selected:outline-dashed aria-selected:outline-ring',
      },
    },
    defaultVariants: { position: 'data-focus' },
  }
);

export type ButtonStyleProps = VariantProps<typeof buttonStyles>;
export type BadgeStyleProps = VariantProps<typeof badgeStyles>;
