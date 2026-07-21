'use client';

import { Grid } from '@giphy/react-components';
import { ImagePlus, Search, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { SocialGif } from '@/types/social';

import { GIPHY_WEB_SDK_KEY, getGiphyClient, type GiphyGif, registerGiphySent } from './giphyClient';
import { createSocialComposerAttemptKey } from './socialComposerDraft';

interface GiphyPickerProps {
  disabled?: boolean;
  onSelect: (gif: SocialGif, idempotencyKey: string) => Promise<void>;
  apiKey?: string;
  compact?: boolean;
}

const PICKER_RESULT_LIMIT = 20;

export default function GiphyPicker({
  disabled = false,
  onSelect,
  apiKey = GIPHY_WEB_SDK_KEY,
  compact = false,
}: GiphyPickerProps): React.JSX.Element | null {
  const client = useMemo(() => getGiphyClient(apiKey), [apiKey]);
  const searchId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const selectionAttemptRef = useRef<{ gifId: string; idempotencyKey: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [gridWidth, setGridWidth] = useState(320);
  const [initialGifs, setInitialGifs] = useState<GiphyGif[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectionPending, setSelectionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = gridRef.current;
    if (!open || !element) return;

    const updateWidth = () => {
      setGridWidth(Math.max(240, Math.floor(element.getBoundingClientRect().width || 320)));
    };
    updateWidth();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    window.requestAnimationFrame(() => {
      if (nextOpen) {
        searchRef.current?.focus();
      } else {
        rootRef.current?.querySelector<HTMLButtonElement>('[data-giphy-trigger]')?.focus();
      }
    });
  }, []);

  const fetchGifs = useMemo(() => {
    if (!client) return null;
    return (offset: number) =>
      searchTerm
        ? client.search(searchTerm, {
            offset,
            limit: PICKER_RESULT_LIMIT,
            rating: 'g',
            type: 'gifs',
          })
        : client.trending({
            offset,
            limit: PICKER_RESULT_LIMIT,
            rating: 'g',
            type: 'gifs',
          });
  }, [client, searchTerm]);

  useEffect(() => {
    if (!open || !fetchGifs) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchGifs(0)
      .then(({ data }) => {
        if (!cancelled) setInitialGifs(data);
      })
      .catch(() => {
        if (!cancelled) {
          setInitialGifs([]);
          setError('GIPHY is unavailable right now.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchGifs, open]);

  const selectGif = useCallback(
    async (gif: GiphyGif) => {
      if (selectionPending) return;
      const gifId = String(gif.id);
      const attempt =
        selectionAttemptRef.current?.gifId === gifId
          ? selectionAttemptRef.current
          : {
              gifId,
              idempotencyKey: createSocialComposerAttemptKey('chat-gif'),
            };
      selectionAttemptRef.current = attempt;
      setSelectionPending(true);
      setError(null);
      try {
        await onSelect({ provider: 'giphy', id: gifId }, attempt.idempotencyKey);
        registerGiphySent(gif);
        selectionAttemptRef.current = null;
        handleOpenChange(false);
      } catch {
        setError('Unable to send that GIF. Please try again.');
      } finally {
        setSelectionPending(false);
      }
    },
    [handleOpenChange, onSelect, selectionPending]
  );

  if (!client || !fetchGifs) return null;

  function handleSearch(): void {
    setError(null);
    setSearchTerm(searchDraft.trim().slice(0, 50));
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    handleSearch();
  }

  return (
    <div ref={rootRef} className={compact ? 'relative' : 'relative mb-2'}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          type="button"
          data-giphy-trigger
          disabled={disabled}
          aria-label="Add a GIF"
          className={
            compact
              ? 'inline-flex size-11 items-center justify-center rounded-lg text-social-text-muted transition-colors hover:bg-social-brand-soft hover:text-social-text active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus disabled:cursor-not-allowed disabled:bg-social-disabled-bg disabled:text-social-disabled-text'
              : 'inline-flex min-h-10 items-center gap-2 rounded-lg border border-social-border bg-social-surface px-3 text-sm font-semibold text-social-text transition-colors hover:border-social-action hover:bg-social-brand-soft active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus disabled:cursor-not-allowed disabled:bg-social-disabled-bg disabled:text-social-disabled-text'
          }
        >
          <ImagePlus className="size-4" aria-hidden="true" />
          {compact ? <span className="sr-only">GIF</span> : 'GIF'}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label="Choose a GIF"
          aria-busy={selectionPending}
          className="bottom-full top-auto mb-2 mt-0 w-[min(24rem,calc(100vw-2rem))] border-social-border bg-social-surface p-3 text-social-text"
        >
          <div className="flex items-center gap-2" role="search">
            <label htmlFor={searchId} className="sr-only">
              Search GIPHY
            </label>
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              maxLength={50}
              placeholder="Search GIPHY"
              className="min-h-10 min-w-0 flex-1 rounded-lg border border-social-border bg-social-surface px-3 text-sm text-social-text outline-none placeholder:text-social-text-muted focus-visible:border-social-action focus-visible:ring-2 focus-visible:ring-social-focus"
            />
            <button
              type="button"
              aria-label="Search GIFs"
              onClick={handleSearch}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-social-action bg-social-action text-social-action-foreground transition-colors hover:border-social-action-hover hover:bg-social-action-hover active:border-social-action-pressed active:bg-social-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus focus-visible:ring-offset-2 focus-visible:ring-offset-social-surface"
            >
              <Search className="size-4" aria-hidden="true" />
            </button>
            {searchTerm ? (
              <button
                type="button"
                aria-label="Clear GIF search"
                onClick={() => {
                  setSearchDraft('');
                  setSearchTerm('');
                  setError(null);
                  searchRef.current?.focus();
                }}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-social-border text-social-text-muted transition-colors hover:border-social-border-strong hover:bg-social-brand-soft hover:text-social-text active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <p className="mt-2 text-xs font-medium text-social-text-muted">
            {searchTerm ? `Results for “${searchTerm}”` : 'Trending GIFs'}
          </p>

          <div
            ref={gridRef}
            className="mt-2 max-h-80 min-h-48 overflow-y-auto rounded-lg bg-social-surface-subtle"
          >
            {loading ? (
              <p role="status" className="py-16 text-center text-sm text-social-text-muted">
                Loading GIFs…
              </p>
            ) : initialGifs.length === 0 ? (
              <p className="py-16 text-center text-sm text-social-text-muted">No GIFs found</p>
            ) : (
              <Grid
                key={searchTerm || 'trending'}
                width={gridWidth}
                columns={gridWidth < 300 ? 2 : 3}
                gutter={6}
                fetchGifs={fetchGifs}
                initialGifs={initialGifs}
                noLink
                tabIndex={selectionPending ? -1 : 0}
                noResultsMessage="No GIFs found"
                onGifsFetchError={() => setError('GIPHY is unavailable right now.')}
                onGifClick={(gif, event) => {
                  event.preventDefault();
                  void selectGif(gif);
                }}
                onGifKeyPress={(gif, event) => {
                  const key = (event.nativeEvent as KeyboardEvent).key;
                  if (key !== 'Enter' && key !== ' ') return;
                  event.preventDefault();
                  void selectGif(gif);
                }}
              />
            )}
          </div>

          {error ? (
            <p role="alert" className="mt-2 text-sm font-medium text-social-error">
              {error}
            </p>
          ) : null}

          <a
            href="https://giphy.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block rounded-sm text-right text-xs font-bold tracking-wide text-social-text underline-offset-4 hover:text-social-action hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
          >
            Powered by GIPHY
          </a>
        </PopoverContent>
      </Popover>
    </div>
  );
}
