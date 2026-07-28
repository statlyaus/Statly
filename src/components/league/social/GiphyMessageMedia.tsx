'use client';

import { Expand, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { SocialGif } from '@/types/social';

import { getGiphyClient, type GiphyGif } from './giphyClient';

interface GiphyMessageMediaProps {
  gif: SocialGif;
}

function getGifImage(gif: GiphyGif): { url: string; width: number; height: number } | null {
  const image = gif.images.downsized_medium ?? gif.images.original;
  if (!image?.url) return null;

  return {
    url: image.url,
    width: Number(image.width) || 480,
    height: Number(image.height) || 360,
  };
}

export default function GiphyMessageMedia({ gif }: GiphyMessageMediaProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const [resolvedGif, setResolvedGif] = useState<GiphyGif | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const giphyUrl = `https://giphy.com/gifs/${encodeURIComponent(gif.id)}`;

  useEffect(() => {
    const client = getGiphyClient();
    if (!client) {
      setFailed(true);
      return;
    }

    let cancelled = false;
    setResolvedGif(null);
    setFailed(false);
    void client
      .gif(gif.id)
      .then(({ data }) => {
        if (cancelled) return;
        if (getGifImage(data)) {
          setResolvedGif(data);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [gif.id]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (expanded && !dialog.open) {
      dialog.showModal();
    } else if (!expanded && dialog.open) {
      dialog.close();
    }
  }, [expanded]);

  const resolvedImage = resolvedGif ? getGifImage(resolvedGif) : null;
  const imageAlt = resolvedGif?.title?.trim() || 'GIF';

  return (
    <div className="mt-2 max-w-[22.5rem]">
      {resolvedGif && resolvedImage ? (
        <>
          <div className="relative max-h-60 overflow-hidden rounded-xl bg-social-surface-subtle">
            <img
              src={resolvedImage.url}
              alt={imageAlt}
              width={resolvedImage.width}
              height={resolvedImage.height}
              loading="lazy"
              decoding="async"
              className="max-h-60 w-full object-cover"
            />
            <button
              ref={expandButtonRef}
              type="button"
              onClick={() => setExpanded(true)}
              className="absolute bottom-2 right-2 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-social-border bg-social-surface px-3 text-xs font-semibold text-social-text shadow-sm transition-colors hover:bg-social-brand-soft active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
              aria-label="Expand GIF"
            >
              <Expand className="size-3.5" aria-hidden="true" />
              Expand
            </button>
          </div>
          <dialog
            ref={dialogRef}
            aria-labelledby={`giphy-preview-${gif.id}`}
            onCancel={() => setExpanded(false)}
            onClose={() => {
              setExpanded(false);
              expandButtonRef.current?.focus();
            }}
            className="m-auto max-h-[90dvh] w-[min(44rem,calc(100vw-2rem))] max-w-none rounded-2xl border border-social-border bg-social-surface p-0 text-social-text shadow-2xl backdrop:bg-social-brand-strong/80 backdrop:backdrop-blur-sm"
          >
            <div className="flex min-h-14 items-center justify-between gap-3 border-b border-social-border px-4">
              <h2 id={`giphy-preview-${gif.id}`} className="text-sm font-semibold">
                GIF preview
              </h2>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="inline-flex size-10 items-center justify-center rounded-full text-social-text-muted transition-colors hover:bg-social-brand-soft hover:text-social-text active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
                aria-label="Close GIF preview"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-[calc(90dvh-3.5rem)] overflow-auto p-4">
              <div className="mx-auto max-w-2xl overflow-hidden rounded-xl bg-social-surface-subtle">
                <img
                  src={resolvedImage.url}
                  alt={imageAlt}
                  width={resolvedImage.width}
                  height={resolvedImage.height}
                  decoding="async"
                  className="h-auto w-full"
                />
              </div>
              <a
                href="https://giphy.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block text-right text-xs font-bold tracking-wide text-social-text-muted underline-offset-4 hover:text-social-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
              >
                Powered by GIPHY
              </a>
            </div>
          </dialog>
        </>
      ) : failed ? (
        <a
          href={giphyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center rounded-lg border border-social-border bg-social-surface-subtle px-3 text-sm font-semibold text-social-text underline-offset-4 transition-colors hover:bg-social-brand-soft hover:underline active:bg-social-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
        >
          View GIF on GIPHY
        </a>
      ) : (
        <div
          role="status"
          className="flex aspect-video items-center justify-center rounded-xl bg-social-surface-subtle text-sm text-social-text-muted"
        >
          Loading GIF…
        </div>
      )}
      {resolvedGif && resolvedImage ? (
        <a
          href="https://giphy.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block text-right text-[10px] font-bold tracking-wide text-social-text-muted underline-offset-4 hover:text-social-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
        >
          Powered by GIPHY
        </a>
      ) : null}
    </div>
  );
}
