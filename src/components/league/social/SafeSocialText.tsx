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
    <p className={`whitespace-pre-wrap break-words text-sm leading-6 text-foreground ${className}`}>
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
                    className="rounded-cut bg-brand-bar px-1 font-semibold text-brand-bar-foreground"
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
            className="font-medium text-primary underline decoration-primary underline-offset-2 transition-colors hover:text-brand-bar-hover active:text-brand-bar-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {part}
          </a>
        );
      })}
    </p>
  );
}
