export type IntentLoader<Key extends string> = Partial<Record<Key, () => Promise<unknown>>>;

export function createIntentPreloader<Key extends string>(
  loaders: IntentLoader<Key>,
  onError: (key: Key, error: unknown) => void
): (key: Key) => Promise<void> {
  const requests = new Map<Key, Promise<void>>();

  return (key: Key): Promise<void> => {
    const existingRequest = requests.get(key);
    if (existingRequest) return existingRequest;

    const loader = loaders[key];
    if (!loader) return Promise.resolve();

    const request = Promise.resolve()
      .then(loader)
      .then(() => undefined)
      .catch((error: unknown) => {
        requests.delete(key);
        onError(key, error);
      });

    requests.set(key, request);
    return request;
  };
}
