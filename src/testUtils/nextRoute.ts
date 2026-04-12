export type TestRouteParams = Record<string, string | string[] | undefined>;

export type TestRouteContext<TParams extends TestRouteParams> = {
  params: Promise<TParams>;
};

export function createRouteContext<TParams extends TestRouteParams>(
  params: TParams
): TestRouteContext<TParams> {
  return {
    params: Promise.resolve(params),
  };
}
