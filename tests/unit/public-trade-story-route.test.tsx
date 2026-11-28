import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAflTradeStoryBundleSource } from '@/server/aflTradeIntelligence/development/tradeStoryBundle';

import { sampleTradeStoryBundle } from '../fixtures/aflTradeStorySampleBundle';

/**
 * The public trade pages (/afl/trades) render only what the public reader returns: the
 * owner-approved bundle's pages, "unavailable" while there is none, and not found for an id the
 * bundle does not hold.
 */

const { loadStoryMock, listStoriesMock, loadClubChainsMock, notFoundMock } = vi.hoisted(() => ({
  loadStoryMock: vi.fn(),
  listStoriesMock: vi.fn(),
  loadClubChainsMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('server-only', () => ({}));
// The home page's lead story loads its typefaces through next/font, which only runs inside Next.
vi.mock('next/font/google', () => {
  const font = () => ({ className: 'font', variable: 'font' });
  return { Permanent_Marker: font, Caveat: font, Newsreader: font, Oswald: font };
});
vi.mock('@/server/aflTradeIntelligence/publication/publicTradeStoryReads', () => ({
  publicTradeStoryReads: {
    loadStory: loadStoryMock,
    listStories: listStoriesMock,
    loadClubChains: loadClubChainsMock,
  },
}));
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

import PublicTradeStoryPage, {
  generateMetadata as storyMetadata,
} from '../../src/app/(public)/afl/trades/[tradeId]/page';
import PublicClubChainsPage, {
  generateMetadata as clubMetadata,
} from '../../src/app/(public)/afl/trades/clubs/[clubId]/page';
import TradeMethodPage from '../../src/app/(public)/afl/trades/method/page';
import PublicTradesPage from '../../src/app/(public)/afl/trades/page';
import AflHubPage from '../../src/app/(public)/afl/page';
import HomePage from '../../src/app/(public)/page';

const source = createAflTradeStoryBundleSource(sampleTradeStoryBundle(), { audience: 'public' });
const list = source.list();
const first = list.stories[0]!;
const available = <T,>(value: T) => ({ available: true as const, value });
const UNAVAILABLE = { available: false as const };
const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('public trade pages', () => {
  /** The list's rows: each opens its trade in the preview beside the list. */
  const tradeLinksOnPage = () => [
    ...document.querySelectorAll<HTMLAnchorElement>(
      'section[aria-labelledby="results-heading"] li > a'
    ),
  ];
  const listPage = (searchParams: Record<string, string> = {}) =>
    PublicTradesPage({ searchParams: Promise.resolve(searchParams) });
  /** A rail link by the words before its count ("2025 3" is the 2025 link). */
  const railLink = (words: string) =>
    within(screen.getByRole('navigation', { name: 'Filter the trades' })).getByRole('link', {
      name: new RegExp(`^${words}\\b`, 'u'),
    });

  beforeEach(() => {
    loadStoryMock.mockImplementation(async (tradeId: string) => available(source.load(tradeId)));
  });

  it('lists every year’s trades, one row each, and no private wording', async () => {
    listStoriesMock.mockResolvedValue(available(list));
    render(await listPage({ year: 'all' }));
    expect(screen.getByRole('heading', { level: 1, name: 'AFL trades, valued' })).toBeVisible();
    const tradeLinks = tradeLinksOnPage();
    expect(tradeLinks).toHaveLength(list.stories.length);
    expect(document.body.innerHTML).not.toMatch(/\/dev\/afl-trade-stories|Private/u);
    const row = tradeLinks.find(
      (a) =>
        new URLSearchParams(a.getAttribute('href')!.split('?')[1]).get('trade') === first.tradeId
    )!;
    for (const result of first.results!) expect(row).toHaveTextContent(result.clubName);
    const lead = [...first.results!].sort((left, right) => right.net - left.net)[0]!;
    expect(row).toHaveTextContent(`${lead.clubName} got ${lead.received.join(', ')}`);
    expect(document.querySelector('main')).toBeNull();
  });

  it('opens the first row in the preview, or the trade the address names', async () => {
    listStoriesMock.mockResolvedValue(available(list));
    render(await listPage({ year: 'all' }));
    const [top] = tradeLinksOnPage();
    expect(top).toHaveAttribute('aria-current', 'true');
    expect(loadStoryMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Open the full trade' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/afl\/trades\/[^?]/u)
    );

    const other = list.stories.at(-1)!;
    render(await listPage({ year: 'all', trade: other.tradeId }));
    expect(loadStoryMock).toHaveBeenLastCalledWith(other.tradeId);
  });

  it('shows the latest year by default and marks the current filter choices', async () => {
    listStoriesMock.mockResolvedValue(available(list));
    render(await listPage());
    const latest = Math.max(...list.stories.map(({ year }) => year));
    expect(tradeLinksOnPage()).toHaveLength(
      list.stories.filter(({ year }) => year === latest).length
    );
    expect(railLink(String(latest))).toHaveAttribute('aria-current', 'true');
    expect(railLink('All clubs')).toHaveAttribute('aria-current', 'true');
    expect(railLink('All years')).toHaveAttribute('href', '/afl/trades?year=all');
  });

  it('filters by club and year together, and offers that club’s chains', async () => {
    listStoriesMock.mockResolvedValue(available(list));
    const clubName = first.clubNames[0]!;
    const slug = clubName.toLowerCase().replace(/[^a-z0-9]+/gu, '-');
    render(await listPage({ club: slug, year: String(first.year) }));
    const expected = list.stories.filter(
      (story) => story.year === first.year && story.clubNames.includes(clubName)
    );
    expect(tradeLinksOnPage()).toHaveLength(expected.length);
    expect(screen.getByRole('link', { name: `${clubName}’s trade chains` })).toHaveAttribute(
      'href',
      expect.stringContaining('/afl/trades/clubs/')
    );
    // Choosing another year keeps the club.
    expect(railLink('All years')).toHaveAttribute('href', `/afl/trades?year=all&club=${slug}`);
  });

  it('shows one trade without private wording or private links', async () => {
    loadStoryMock.mockResolvedValue(available(source.load(first.tradeId)));
    render(await PublicTradeStoryPage(params({ tradeId: encodeURIComponent(first.tradeId) })));
    expect(loadStoryMock).toHaveBeenCalledWith(first.tradeId);
    expect(screen.getByRole('link', { name: 'How this works' })).toHaveAttribute(
      'href',
      '/afl/trades/method'
    );
    expect(screen.getByRole('link', { name: 'AFL trades' })).toHaveAttribute('href', '/afl/trades');
    expect(document.body.innerHTML).not.toMatch(
      /\/dev\/afl-trade-stories|Private page|Not for publication/u
    );
    // The public layout provides <main>; the page must not nest a second one.
    expect(document.querySelector('main')).toBeNull();
  });

  it('opens a trade with its collage: one heading, each club’s result, and who led when', async () => {
    const model = source.load(first.tradeId)!;
    loadStoryMock.mockResolvedValue(available(model));
    render(await PublicTradeStoryPage(params({ tradeId: encodeURIComponent(first.tradeId) })));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const clubs = within(screen.getByRole('list', { name: 'Each club’s result and what it got' }));
    for (const side of model.story.sides)
      expect(clubs.getAllByText(side.clubName).length).toBeGreaterThan(0);
    // One stop for every point the trade's net line holds, oldest first.
    const band = within(screen.getByRole('list', { name: 'Who was ahead, point by point' }));
    expect(band.getAllByRole('listitem')).toHaveLength(model.story.nets.tradeAlone[0]!.line.length);
  });

  it('puts where the trade went straight under the collage, ahead of what each club gave', async () => {
    loadStoryMock.mockResolvedValue(available(source.load(first.tradeId)!));
    render(await PublicTradeStoryPage(params({ tradeId: encodeURIComponent(first.tradeId) })));
    const collage = screen.getByRole('list', { name: 'Who was ahead, point by point' });
    const tree = screen.getByRole('region', { name: 'Where the trade went' });
    const gave = screen.getByRole('list', { name: 'What each club gave' });
    expect(collage.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tree.compareDocumentPosition(gave) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a club’s chains with public links', async () => {
    loadClubChainsMock.mockResolvedValue(available(source.loadClub(first.clubIds[0]!)));
    render(await PublicClubChainsPage(params({ clubId: encodeURIComponent(first.clubIds[0]!) })));
    expect(document.body.innerHTML).not.toMatch(/\/dev\/afl-trade-stories|Private page/u);
    expect(document.querySelector('main')).toBeNull();
  });

  it('says unavailable on every page while no approved bundle is served', async () => {
    listStoriesMock.mockResolvedValue(UNAVAILABLE);
    loadStoryMock.mockResolvedValue(UNAVAILABLE);
    loadClubChainsMock.mockResolvedValue(UNAVAILABLE);
    for (const page of [
      await PublicTradesPage({ searchParams: Promise.resolve({}) }),
      await PublicTradeStoryPage(params({ tradeId: 'x' })),
      await PublicClubChainsPage(params({ clubId: 'x' })),
    ]) {
      const { unmount } = render(page);
      expect(
        screen.getByText(
          'Trade records are unavailable. This page cannot load until they are back.'
        )
      ).toBeVisible();
      unmount();
    }
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('answers not found for an unknown or malformed trade or club', async () => {
    loadStoryMock.mockResolvedValue(available(null));
    loadClubChainsMock.mockResolvedValue(available(null));
    await expect(PublicTradeStoryPage(params({ tradeId: 'unknown' }))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
    await expect(PublicClubChainsPage(params({ clubId: 'unknown' }))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
    await expect(PublicTradeStoryPage(params({ tradeId: '%E0%A4%A' }))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
    await expect(PublicTradeStoryPage(params({ tradeId: '../etc' }))).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
    expect(loadStoryMock).toHaveBeenCalledTimes(1);
  });

  it('titles a trade and a club for search, and hides unavailable or unknown ones', async () => {
    loadStoryMock.mockResolvedValue(available(source.load(first.tradeId)));
    const story = await storyMetadata(params({ tradeId: first.tradeId }));
    expect(story.title).toContain(String(first.year));
    expect(story.robots).toBeUndefined();
    loadClubChainsMock.mockResolvedValue(available(source.loadClub(first.clubIds[0]!)));
    expect((await clubMetadata(params({ clubId: first.clubIds[0]! }))).title).toContain(
      'trade chains'
    );
    loadStoryMock.mockResolvedValue(UNAVAILABLE);
    expect((await storyMetadata(params({ tradeId: first.tradeId }))).robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it('walks through the method step by step, says what is not final, and credits each source', () => {
    render(TradeMethodPage());
    expect(
      screen.getByRole('heading', { level: 1, name: 'How Statly values trades' })
    ).toBeVisible();
    const references = screen.getByRole('list', { name: 'References' });
    for (const name of [
      /^HPN/u,
      /^AFL Tables/u,
      /^Footywire and the AFL/u,
      /^Draftguru/u,
      /^Footyinfo/u,
    ])
      expect(within(references).getByText(name)).toBeVisible();
    // Every step is reachable, and the trade steps say what is not final and what PAV misses.
    const next = () => screen.getByRole('button', { name: /^Next/u });
    for (let i = 0; i < 16; i += 1) fireEvent.click(next());
    expect(screen.getByRole('heading', { level: 2, name: "What isn't final yet" })).toBeVisible();
    fireEvent.click(next());
    expect(screen.getByRole('heading', { level: 2, name: "What PAV doesn't see" })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start again' })).toBeVisible();
  });

  it('makes the home page the trades’ front page: ladder, biggest win and seasons', async () => {
    listStoriesMock.mockResolvedValue(available(list));
    loadStoryMock.mockImplementation(async (tradeId: string) => available(source.load(tradeId)));
    render(await HomePage());
    expect(
      screen.getByRole('heading', { level: 1, name: 'Every October, footy goes to market.' })
    ).toBeVisible();
    // The ladder ranks every club and each row opens that club's trades.
    const ladder = screen.getByRole('heading', { name: 'The trade ladder' }).closest('section')!;
    const rows = [...ladder.querySelectorAll('ol a')];
    const clubs = new Set(list.stories.flatMap(({ clubNames }) => clubNames));
    expect(rows).toHaveLength(clubs.size);
    for (const row of rows)
      expect(row.getAttribute('href')).toMatch(/^\/afl\/trades\?year=all&club=[a-z0-9-]+$/u);
    // The biggest wins are a ranked scoreboard, each row opening its trade.
    const wins = screen.getByRole('heading', { name: 'The next biggest wins' }).closest('section')!;
    for (const row of wins.querySelectorAll('ol > li > a'))
      expect(row.getAttribute('href')).toMatch(/^\/afl\/trades\//u);
    // The season chart has one bar per trade year, oldest first.
    const seasons = screen.getByRole('heading', { name: 'Season by season' }).closest('section')!;
    const years = [...new Set(list.stories.map(({ year }) => year))].sort((a, b) => a - b);
    expect([...seasons.querySelectorAll('ol > li > a')].map((a) => a.getAttribute('href'))).toEqual(
      years.map((year) => `/afl/trades?year=${year}`)
    );
    const latest = Math.max(...list.stories.map(({ year }) => year));
    expect(
      screen
        .getAllByRole('link')
        .some((a) => a.getAttribute('href') === `/afl/trades?year=${latest}`)
    ).toBe(true);
    expect(screen.getByRole('link', { name: /Read the trade/u })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/afl\/trades\//u)
    );
    expect(document.body.innerHTML).not.toMatch(/\/dev\/afl-trade-stories|Private/u);
  });

  it('keeps the home page to its own links while the trades are not being served', async () => {
    listStoriesMock.mockResolvedValue(UNAVAILABLE);
    render(await HomePage());
    expect(screen.getByRole('link', { name: 'See every trade' })).toHaveAttribute(
      'href',
      '/afl/trades'
    );
    expect(screen.queryByRole('heading', { name: 'Pick your club' })).toBeNull();
  });

  it('links the AFL hub to the trade pages', () => {
    render(AflHubPage());
    expect(screen.getByRole('link', { name: /Trades/u })).toHaveAttribute('href', '/afl/trades');
    // The draft record card is hidden until a reviewed factual release is published.
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/afl/trades',
    ]);
  });
});
