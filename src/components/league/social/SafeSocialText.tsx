const URL_PATTERN = /(https?:\/\/[^\s<]+)/gi;
/** An @name at the start of the text or after whitespace, as `containsSocialMention` reads it. */
const MENTION_PATTERN = /((?<=^|\s)@[a-z0-9][a-z0-9._-]*)/gi;

interface SafeSocialTextProps {
  value: string;
  className?: string;
  /** Shows each @name as a pill (league chat). */
  highlightMentions?: boolean;
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function SafeSocialText({
  value,
  className = '',
  highlightMentions = false,
}: SafeSocialTextProps): React.JSX.Element {
  const parts = value.split(URL_PATTERN);

  return (
    <p
      className={`whitespace-pre-wrap break-words text-sm leading-6 text-social-text ${className}`}
    >
      {parts.map((part, index) => {
        const href = safeExternalUrl(part);
        if (!href) {
          if (!highlightMentions) return <span key={`${index}:${part}`}>{part}</span>;
          return (
            <span key={`${index}:${part}`}>
              {part.split(MENTION_PATTERN).map((piece, pieceIndex) =>
                pieceIndex % 2 === 1 ? (
                  <span
                    key={pieceIndex}
                    data-mention
                    className="rounded-md bg-social-mention-pill px-1 font-semibold text-social-mention-pill-text"
                  >
                    {piece}
                  </span>
                ) : (
                  piece
                )
              )}
            </span>
          );
        }
        return (
          <a
            key={`${index}:${part}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-social-link underline decoration-social-link underline-offset-2 transition-colors hover:text-social-action-hover active:text-social-action-pressed focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
          >
            {part}
          </a>
        );
      })}
    </p>
  );
}
