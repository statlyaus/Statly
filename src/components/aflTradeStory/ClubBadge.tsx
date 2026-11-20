import { clubSquare, clubStyle } from './tradePageModel';

/**
 * A club as its 13px club square beside its abbreviation (style guide, "Club colours"): the only
 * place a club's colour appears. Text is never set on the colour. The full name is read out unless
 * it is already written beside the badge (`named`).
 */
export function ClubBadge({
  clubName,
  size = 'sm',
  named = false,
}: {
  clubName: string;
  size?: 'sm' | 'md';
  named?: boolean;
}) {
  const square = clubSquare(clubName);
  return (
    <span
      className={`inline-flex flex-none items-center gap-1.5 font-display font-extrabold tracking-wide ${
        size === 'md' ? 'text-sm' : 'text-xs'
      }`}
      aria-hidden={named || undefined}
    >
      <span
        aria-hidden="true"
        className={`size-[13px] flex-none ${square.edged ? 'border-[1.5px] border-foreground' : ''}`}
        style={{ background: square.fill }}
      />
      <span aria-hidden="true">{clubStyle(clubName).abbreviation}</span>
      {named ? null : <span className="sr-only">{clubName}</span>}
    </span>
  );
}
