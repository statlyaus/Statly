'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { CAMERON_CHAPTERS, CAMERON_SOURCES } from './cameronChapters';
import {
  CAMERON_STANDFIRST,
  CameronHeroCollage,
  CameronTitle,
  ChapterSlips,
  STORY_COLLAGE_CLASS,
} from './CameronMasthead';
import { CameronTimeline } from './CameronTimeline';
import { Sketch } from './collageParts';

/**
 * The Jeremy Cameron story page: the masthead, then six chapters. Each chapter shows its headline and
 * collage; "Read the chapter" opens the words behind it.
 */
export function CameronStoryPage({ tradeHref }: { tradeHref: string | null }) {
  const [open, setOpen] = useState<readonly boolean[]>(() => CAMERON_CHAPTERS.map(() => false));
  const allOpen = open.every(Boolean);
  const set = (chapter: number, value: boolean) =>
    setOpen((now) => now.map((was, index) => (index === chapter ? value : was)));

  return (
    <article className={STORY_COLLAGE_CLASS}>
      <header
        className="sc-wrap"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2.5rem',
          paddingTop: '2.5rem',
          paddingBottom: '2rem',
        }}
      >
        <div className="sc-bar sc-label" style={{ fontSize: 15 }}>
          <span>AFL stories · Jeremy Cameron</span>
          <span>2010–22</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2.5rem', alignItems: 'center' }}>
          <div
            style={{
              flex: '1 1 380px',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '1.6rem',
            }}
          >
            <CameronTitle />
            <p
              style={{
                margin: 0,
                maxWidth: 520,
                fontStyle: 'italic',
                fontSize: 23,
                lineHeight: 1.45,
                color: '#2A2A2A',
              }}
            >
              {CAMERON_STANDFIRST}
            </p>
          </div>
          <div style={{ flex: '1.25 1 520px', minWidth: 0 }}>
            <CameronHeroCollage />
          </div>
        </div>
        <CameronTimeline
          hint="Pick a year, or scroll for the story ↓"
          onOpen={(chapter) => set(chapter, true)}
        />
      </header>

      <div className="sc-wrap" style={{ paddingTop: '2rem', paddingBottom: '1rem' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '2.5rem',
          }}
        >
          <p className="sc-hand" style={{ fontSize: 30, color: 'var(--sc-red)' }}>
            Rewind to 2010…
          </p>
          <button
            type="button"
            className="sc-more sc-label"
            onClick={() => setOpen(CAMERON_CHAPTERS.map(() => !allOpen))}
          >
            {allOpen ? 'Close all chapters' : 'Open all chapters'}
          </button>
        </div>
        {CAMERON_CHAPTERS.map((chapter, index) => {
          const id = `ch${index + 1}`;
          return (
            <section
              key={id}
              id={id}
              aria-labelledby={`${id}-title`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2rem',
                paddingBottom: '4.5rem',
                scrollMarginTop: '1rem',
              }}
            >
              <div className="sc-bar sc-label">
                <span>{chapter.kicker}</span>
                <span>{chapter.when}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '2.5rem',
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    flex: '1 1 320px',
                    maxWidth: 440,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1.1rem',
                    paddingTop: '0.5rem',
                  }}
                >
                  <h2
                    id={`${id}-title`}
                    style={{
                      margin: 0,
                      fontWeight: 500,
                      fontSize: 'clamp(40px, 4.4vw, 62px)',
                      lineHeight: 1.02,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {chapter.title}
                  </h2>
                  <p style={{ margin: 0, fontSize: 20, lineHeight: 1.5, color: '#333' }}>
                    {chapter.standfirst}
                  </p>
                  <button
                    type="button"
                    className="sc-more sc-label"
                    aria-expanded={open[index]}
                    aria-controls={`${id}-words`}
                    onClick={() => set(index, !open[index])}
                  >
                    {open[index] ? 'Close chapter' : 'Read the chapter'}
                    <ChevronDown
                      aria-hidden="true"
                      size={16}
                      strokeWidth={2.4}
                      style={{
                        transform: `rotate(${open[index] ? 180 : 0}deg)`,
                        transition: 'transform 200ms',
                      }}
                    />
                  </button>
                </div>
                <div style={{ flex: '2 1 560px', minWidth: 0 }}>{chapter.collage}</div>
              </div>
              <div
                id={`${id}-words`}
                hidden={!open[index]}
                style={{ borderTop: '2px solid var(--sc-ink)', paddingTop: '2rem' }}
              >
                <div className="sc-cols">
                  {chapter.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
                {chapter.quote ? (
                  <blockquote style={{ margin: '1.5rem 0 0', padding: 0, maxWidth: 860 }}>
                    <p
                      style={{
                        margin: 0,
                        fontStyle: 'italic',
                        fontSize: 'clamp(32px, 4vw, 56px)',
                        lineHeight: 1.08,
                      }}
                    >
                      {chapter.quote.words}
                    </p>
                    <p
                      className="sc-label"
                      style={{ margin: '0.6rem 0 0', fontWeight: 500, fontSize: 13, color: '#555' }}
                    >
                      {chapter.quote.by}
                    </p>
                  </blockquote>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      <footer
        className="sc-wrap"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.6rem',
          paddingTop: '1rem',
          paddingBottom: '4rem',
        }}
      >
        <h2
          className="sc-marker"
          style={{ margin: 0, fontSize: 'clamp(40px, 5vw, 72px)', lineHeight: 1 }}
        >
          The whole road
        </h2>
        <Sketch
          name="route"
          style={{ position: 'static', width: '100%', maxWidth: 900, height: 'auto' }}
        />
        <ChapterSlips label="Chapters again" onOpen={(chapter) => set(chapter, true)} />
        <p style={{ margin: '1rem 0 0', display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1.5rem' }}>
          {tradeHref ? (
            <a href={tradeHref} className="sc-more sc-label">
              Who won the trade? See the numbers →
            </a>
          ) : null}
          <a href="/afl/trades" className="sc-more sc-label">
            Every trade →
          </a>
        </p>
        <p style={{ margin: '1.5rem 0 0', fontSize: 14, lineHeight: 1.6, color: '#444' }}>
          {CAMERON_SOURCES}
        </p>
      </footer>
    </article>
  );
}
