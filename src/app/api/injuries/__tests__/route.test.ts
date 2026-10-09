import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/injuries/route';

function footywirePage(rows: string[]): string {
  return `<html><body><table><tr><th>Player</th><th>Team</th><th>Injury</th><th>Returning</th></tr>${rows.join(
    ''
  )}</table></body></html>`;
}

function stubFootywire(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function readFailure(response: Response) {
  expect(response.status).toBe(502);
  const body = await response.json();
  expect(body.success).toBe(false);
  expect(body.data).toEqual([]);
  expect(body.count).toBe(0);
  expect(typeof body.error).toBe('string');
  return body;
}

describe('GET /api/injuries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fails closed with no data when the Footywire fetch throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFootywire(new Error('network down'));

    const body = await readFailure(await GET(new Request('http://localhost/api/injuries')));

    expect(body.source).toBe('footywire_scrape_failed');
  });

  it('fails closed with no data when Footywire returns an error status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFootywire(new Response('nope', { status: 503, statusText: 'Service Unavailable' }));

    const body = await readFailure(
      await GET(new Request('http://localhost/api/injuries?team=Carlton'))
    );

    expect(body.source).toBe('footywire_scrape_failed');
    expect(body.teamFilter).toBe('Carlton');
  });

  it('fails closed when the scrape parses no injuries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFootywire(new Response('<html><body><p>no tables</p></body></html>', { status: 200 }));

    const body = await readFailure(await GET(new Request('http://localhost/api/injuries')));

    expect(body.source).toBe('footywire_scrape_empty');
  });

  it('fails closed when the scrape returns an implausible number of rows', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const rows = Array.from(
      { length: 301 },
      (_, i) =>
        `<tr><td>Sam Example${i}</td><td>Carlton</td><td>Hamstring</td><td>1-2 weeks</td></tr>`
    );
    stubFootywire(new Response(footywirePage(rows), { status: 200 }));

    const body = await readFailure(await GET(new Request('http://localhost/api/injuries')));

    expect(body.source).toBe('footywire_scrape_implausible_size');
  });

  it('serves the scraped Footywire list as success', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    stubFootywire(
      new Response(
        footywirePage([
          '<tr><td>Sam Example</td><td>Carlton</td><td>Hamstring</td><td>1-2 weeks</td></tr>',
        ]),
        { status: 200 }
      )
    );

    const response = await GET(new Request('http://localhost/api/injuries'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, source: 'footywire', count: 1 });
    expect(body.data[0]).toMatchObject({ name: 'Sam Example', injury: 'Hamstring' });
  });
});
