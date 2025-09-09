import { describe, it, expect } from 'vitest';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { QueryProvider } from '@/providers/QueryProvider';
import { useQuery } from '@tanstack/react-query';

function Example() {
  const { data } = useQuery({ queryKey: ['x'], queryFn: () => 'hello' });
  return <div>{data}</div>;
}

describe('query hydration', () => {
  it('hydrates prefetched data', async () => {
    const qc = new QueryClient();
    await qc.prefetchQuery({ queryKey: ['x'], queryFn: () => 'hello' });
    const html = renderToString(
      <QueryProvider state={dehydrate(qc)}>
        <Example />
      </QueryProvider>
    );
    expect(html).toContain('hello');
  });
});
