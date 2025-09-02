## Public API Reference (excerpt)

### GET /api/player-stats

Query params:

- `season` (string; default "2025")
- `round` (string; optional)
- `limit` (number; default 500, max 5000)
- `cursor` (string; returns next page from previous response)

Response 200 JSON:

```
{
  "success": true,
  "data": [ /* player stat objects */ ],
  "count": 500,
  "timestamp": "2025-...",
  "query": { "season": "2025", "round": "1", "limit": 500, "cursor": null, "nextCursor": "..." }
}
```

Notes:

- Results are ordered by document id; use `nextCursor` to paginate.
- CDN cache: `Cache-Control: s-maxage=300, stale-while-revalidate=1800`.

### GET /api/live-player-stats?matchUid=...

Returns live stats per player for the match; short cache TTL (10s). Rate limited to 100 requests per minute per IP, tracked globally across the API (shared across endpoints). When the limit is exceeded, the server responds with HTTP 429 Too Many Requests, includes a Retry-After header (seconds until reset) and X-RateLimit-\* headers; there are no API key exemptions.

### GET /api/metrics

Returns aggregate application metrics for the last hour.

Response 200 JSON (excerpt):

```
{
  "totalRequests": 1234,
  "totalErrors": 12,
  "errorRate": 0.0097,
  "averageResponseTime": 42,
  "uptime": 3600000
}
```
