import { describe, it, expect } from 'vitest';
import { GET } from '../../app/api/ping/route';

describe('GET /api/ping', () => {
  it('returns ok status', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.time).toBe('string');
  });
});
