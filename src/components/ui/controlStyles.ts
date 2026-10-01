import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Class recipes for plain controls built on Statly's semantic tokens. They replace DaisyUI
 * component classes (btn, badge, input, …), which the stylesheet does not load and which
 * therefore rendered unstyled. Primary actions and focus use the navy brand-bar, and badges are
 * squared, per docs/product/design-principles.md.
 */

export const buttonStyles = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'bg-brand-bar text-brand-bar-foreground hover:bg-brand-bar/90',
        outline: 'border border-border bg-background text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        danger: 'bg-result-loss text-result-loss-foreground hover:bg-result-loss/90',
      },
      size: {
        lg: 'min-h-12 px-6 text-base',
        md: 'min-h-11 px-4 text-sm',
        sm: 'min-h-9 px-3 text-sm',
        xs: 'min-h-7 px-2 text-xs',
      },
    },
    defaultVariants: { variant: 'outline', size: 'md' },
  }
);

export const badgeStyles = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-sm border font-semibold',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-background text-muted-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        brand: 'border-brand-bar/30 bg-brand-bar/5 text-brand-bar',
        win: 'border-result-win/30 bg-result-win/5 text-result-win',
        loss: 'border-result-loss/30 bg-result-loss/5 text-result-loss',
        draw: 'border-result-draw/40 bg-result-draw/10 text-foreground',
        warning: 'border-warning/50 bg-warning/10 text-foreground',
      },
      size: {
        xs: 'px-1.5 text-[11px] leading-5',
        sm: 'px-2 text-xs leading-5',
        md: 'px-2.5 py-0.5 text-sm',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'sm' },
  }
);

export const fieldStyles = cva(
  'w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
  {
    variants: { size: { md: 'h-11', sm: 'h-9', area: 'min-h-24 py-2' } },
    defaultVariants: { size: 'md' },
  }
);

export const fieldLabelStyles = 'flex flex-col gap-1 text-sm font-medium text-foreground';

export const kbdStyles =
  'rounded-sm border border-border bg-muted px-1 font-mono text-[11px] font-semibold text-foreground';

export const textLinkStyles =
  'font-semibold text-foreground underline decoration-transparent underline-offset-4 hover:decoration-current focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export type ButtonStyleProps = VariantProps<typeof buttonStyles>;
export type BadgeStyleProps = VariantProps<typeof badgeStyles>;
