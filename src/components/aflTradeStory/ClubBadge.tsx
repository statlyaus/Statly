import { clubStyle } from './tradePageModel';

/**
 * A club's short name on its guernsey colour. The full name is read out unless the club's name is
 * already written beside the badge (`named`).
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
  const style = clubStyle(clubName);
  return (
    <span
      className={`inline-flex flex-none items-center justify-center rounded-full border-2 font-semibold tracking-wide ${
        size === 'md' ? 'h-7 min-w-11 px-2.5 text-sm' : 'h-6 min-w-10 px-2 text-xs'
      }`}
      style={{ background: style.fill, color: style.ink, borderColor: style.trim }}
      aria-hidden={named || undefined}
    >
      <span aria-hidden="true">{style.abbreviation}</span>
      {named ? null : <span className="sr-only">{clubName}</span>}
    </span>
  );
}
