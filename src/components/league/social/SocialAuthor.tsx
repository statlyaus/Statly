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
      <span
        className={`${compact ? 'size-8' : 'size-10'} flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-xs font-semibold text-muted-foreground`}
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
          getInitials(displayName)
        )}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-semibold text-foreground">{displayName}</span>
          <span className="truncate text-xs text-muted-foreground">{teamName}</span>
        </span>
        <span className="block text-xs text-muted-foreground">
          <time dateTime={timestamp}>{formattedTimestamp}</time>
          {editedAt ? <span aria-label="Edited"> · Edited</span> : null}
        </span>
      </span>
    </div>
  );
}
