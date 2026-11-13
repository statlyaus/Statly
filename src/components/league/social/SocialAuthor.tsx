import type { SocialAuthor as SocialAuthorIdentity } from '@/types/social';

interface SocialAuthorProps {
  author: SocialAuthorIdentity | null;
  timestamp: string;
  editedAt?: string;
  compact?: boolean;
  timestampStyle?: 'date-and-time' | 'time';
}

function getInitials(value: string): string {
  const initials = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return initials || 'S';
}

function formatTimestamp(value: string, style: 'date-and-time' | 'time'): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown time';
  if (style === 'time') {
    return new Intl.DateTimeFormat('en-AU', {
      timeStyle: 'short',
    }).format(parsed);
  }
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

/** Dark enough for white initials at 4.5:1; a member keeps one colour everywhere they appear. */
const AVATAR_COLOURS = [
  '#1f4fa8',
  '#b3202f',
  '#0b6b53',
  '#7a3fb0',
  '#9a5200',
  '#22262b',
  '#0b3a6b',
  '#a3266f',
];

function avatarColour(author: SocialAuthorIdentity | null): string {
  const key = author?.userId || author?.displayName || '';
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}

/** The member's avatar, or their initials when they have none. Decorative: the name sits beside it. */
export function SocialAvatar({
  author,
  compact = false,
  shape = 'circle',
}: {
  author: SocialAuthorIdentity | null;
  compact?: boolean;
  shape?: 'circle' | 'square';
}): React.JSX.Element {
  return (
    <span
      className={`${compact ? 'size-8' : 'size-10'} flex shrink-0 items-center justify-center overflow-hidden ${shape === 'square' ? 'rounded-xl' : 'rounded-full'} text-xs font-bold tracking-wide text-white`}
      style={author?.avatarUrl ? undefined : { backgroundColor: avatarColour(author) }}
      aria-hidden="true"
    >
      {author?.avatarUrl ? (
        <img
          src={author.avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        getInitials(author?.displayName || 'Former member')
      )}
    </span>
  );
}

export function formatSocialTime(value: string): string {
  return formatTimestamp(value, 'time');
}

export default function SocialAuthor({
  author,
  timestamp,
  editedAt,
  compact = false,
  timestampStyle = 'date-and-time',
}: SocialAuthorProps): React.JSX.Element {
  const displayName = author?.displayName || 'Former member';
  const teamName = author?.teamName || 'Team unavailable';
  const formattedTimestamp = formatTimestamp(timestamp, timestampStyle);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <SocialAvatar author={author} compact={compact} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-semibold text-social-text">{displayName}</span>
          <span className="truncate text-xs text-social-text-muted">{teamName}</span>
        </span>
        <span className="block text-xs text-social-text-muted">
          <time dateTime={timestamp}>{formattedTimestamp}</time>
          {editedAt ? <span aria-label="Edited"> · Edited</span> : null}
        </span>
      </span>
    </div>
  );
}
