import { LoaderCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

const SIZES = { sm: 'size-4', md: 'size-8', lg: 'size-16' } as const;

interface SpinnerProps {
  /**
   * What is loading, in words ("Loading the league"), announced to screen readers. Leave it out only
   * when visible text beside the spinner already says what is happening ("Saving…").
   */
  label?: string;
  size?: keyof typeof SIZES;
  /** Take the surrounding text colour (inside a filled button) instead of cobalt. */
  inherit?: boolean;
  className?: string;
}

/**
 * The one spinner (style guide, "Numbers, empty states, loading"): a cobalt ring that turns
 * only when motion is allowed, and names the thing loading.
 */
export function Spinner({
  label,
  size = 'md',
  inherit = false,
  className,
}: SpinnerProps): React.JSX.Element {
  const ring = (
    <LoaderCircle
      aria-hidden="true"
      className={cn(SIZES[size], 'shrink-0 motion-safe:animate-spin', !inherit && 'text-primary')}
    />
  );

  if (!label) return <span className={cn('inline-flex', className)}>{ring}</span>;

  return (
    <span role="status" className={cn('inline-flex items-center gap-2', className)}>
      {ring}
      <span className="sr-only">{label}</span>
    </span>
  );
}
