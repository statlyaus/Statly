'use client';

import { Grid } from '@giphy/react-components';
import { ImagePlus, Search, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { SocialGif } from '@/types/social';

import { GIPHY_WEB_SDK_KEY, getGiphyClient, type GiphyGif, registerGiphySent } from './giphyClient';

interface GiphyPickerProps {
  disabled?: boolean;
  onSelect: (gif: SocialGif) => Promise<void>;
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
      setSelectionPending(true);
      setError(null);
      try {
        await onSelect({ provider: 'giphy', id: String(gif.id) });
        registerGiphySent(gif);
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

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    setSearchTerm(searchDraft.trim().slice(0, 50));
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
              ? 'inline-flex size-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40'
              : 'inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
          }
        >
          <ImagePlus className="size-4" aria-hidden="true" />
          {compact ? <span className="sr-only">GIF</span> : 'GIF'}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label="Choose a GIF"
          aria-busy={selectionPending}
          className="bottom-full top-auto mb-2 mt-0 w-[min(24rem,calc(100vw-2rem))] p-3"
        >
          <form className="flex items-center gap-2" onSubmit={handleSearch} role="search">
            <label htmlFor={searchId} className="sr-only">
              Search GIPHY
            </label>
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              maxLength={50}
              placeholder="Search GIPHY"
              className="min-h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              aria-label="Search GIFs"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </form>

          <p className="mt-2 text-xs font-medium text-muted-foreground">
            {searchTerm ? `Results for “${searchTerm}”` : 'Trending GIFs'}
          </p>

          <div
            ref={gridRef}
            className="mt-2 max-h-80 min-h-48 overflow-y-auto rounded-lg bg-muted/30"
          >
            {loading ? (
              <p role="status" className="py-16 text-center text-sm text-muted-foreground">
                Loading GIFs…
              </p>
            ) : initialGifs.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No GIFs found</p>
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
            <p role="alert" className="mt-2 text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}

          <a
            href="https://giphy.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block text-right text-xs font-bold tracking-wide text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Powered by GIPHY
          </a>
        </PopoverContent>
      </Popover>
    </div>
  );
}
