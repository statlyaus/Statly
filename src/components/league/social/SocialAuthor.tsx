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
/**
 * Coach colours for the avatar, name and bubble stripe, so each coach's messages are told apart at a
 * glance. Ten distinct hues; `light` is at least 5.2:1 on white and the light canvas (and carries
 * white initials), `dark` at least 7.3:1 on the dark bubble and canvas.
 */
export const MEMBER_COLOURS = [
  { light: '#1f4fa8', dark: '#8fb4ff' },
  { light: '#b3202f', dark: '#ff9a9f' },
  { light: '#0b6b53', dark: '#6fd3b0' },
  { light: '#7a3fb0', dark: '#c9a4f5' },
  { light: '#9a5200', dark: '#ffb366' },
  { light: '#a3266f', dark: '#f59acb' },
  { light: '#0e6577', dark: '#7fd4e6' },
  { light: '#5a6a00', dark: '#c8d86a' },
  { light: '#8a4b14', dark: '#e0b088' },
  { light: '#475569', dark: '#cbd5e1' },
] as const;

function authorKey(author: SocialAuthorIdentity | null): string {
  return author?.userId || author?.displayName || '';
}

function preferredColourIndex(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return hash % MEMBER_COLOURS.length;
}

/**
 * Gives every author in a conversation a different colour while there are colours left: each takes
 * its preferred colour, or the next free one when another author already has it. Authors are placed
 * in a fixed order (by key), so the same people always get the same colours.
 */
export function assignMemberColours(
  authors: Array<SocialAuthorIdentity | null>
): Map<string, number> {
  const keys = [...new Set(authors.map(authorKey))].sort();
  const taken = new Set<number>();
  const assigned = new Map<string, number>();
  for (const key of keys) {
    let index = preferredColourIndex(key);
    for (let step = 0; step < MEMBER_COLOURS.length && taken.has(index); step += 1) {
      index = (index + 1) % MEMBER_COLOURS.length;
    }
    taken.add(index);
    assigned.set(key, index);
  }
  return assigned;
}

export function memberColourIndex(
  author: SocialAuthorIdentity | null,
  assigned?: Map<string, number>
): number {
  const key = authorKey(author);
  return assigned?.get(key) ?? preferredColourIndex(key);
}

/** Inline custom properties that `[data-member-colour]` in index.css turns into `--member`. */
export function memberColourStyle(colourIndex: number): React.CSSProperties {
  const colour = MEMBER_COLOURS[colourIndex % MEMBER_COLOURS.length];
  return { '--member-light': colour.light, '--member-dark': colour.dark } as React.CSSProperties;
}

/** The member's avatar, or their initials when they have none. Decorative: the name sits beside it. */
export function SocialAvatar({
  author,
  compact = false,
  shape = 'circle',
  colourIndex,
}: {
  author: SocialAuthorIdentity | null;
  compact?: boolean;
  shape?: 'circle' | 'square';
  /** The colour this author has in the conversation; defaults to their preferred colour. */
  colourIndex?: number;
}): React.JSX.Element {
  return (
    <span
      className={`${compact ? 'size-8' : 'size-10'} flex shrink-0 items-center justify-center overflow-hidden ${shape === 'square' ? 'rounded-xl' : 'rounded-full'} text-xs font-bold tracking-wide text-white`}
      style={
        author?.avatarUrl
          ? undefined
          : {
              backgroundColor: MEMBER_COLOURS[colourIndex ?? memberColourIndex(author)].light,
            }
      }
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
