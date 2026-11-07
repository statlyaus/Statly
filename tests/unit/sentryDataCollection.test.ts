import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { privateSentryDataCollection } from '@/lib/sentry/dataCollection';

describe('Sentry data collection', () => {
  it('keeps personal and request data out of Sentry, as sendDefaultPii: false did in v10', () => {
    expect(privateSentryDataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: true,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });

  it.each(['src/sentry.server.config.ts', 'src/sentry.edge.config.ts'])(
    '%s always passes the private data collection',
    (file) => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');

      expect(source).toContain('dataCollection: privateSentryDataCollection');
    }
  );

  it('the browser uses Sentry defaults only when personal data is opted in', () => {
    const source = readFileSync(join(process.cwd(), 'src/instrumentation-client.ts'), 'utf8');

    expect(source).not.toContain('sendDefaultPii');
    expect(source).toMatch(
      /dataCollection:\s*sendPersonalData \? undefined : privateSentryDataCollection/
    );
  });
});
