import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createRequest(
  url: string,
  init: RequestInit = {},
  browserMetadata: { destination?: RequestDestination; mode?: RequestMode } = {}
): Request {
  const request = new Request(url, init);

  if (browserMetadata.destination !== undefined) {
    Object.defineProperty(request, 'destination', { value: browserMetadata.destination });
  }
  if (browserMetadata.mode !== undefined) {
    Object.defineProperty(request, 'mode', { value: browserMetadata.mode });
  }

  return request;
}

describe('isAuthServiceWorkerRequestEligible', () => {
  it('allows secure same-origin navigations and loopback development navigations', async () => {
    const { isAuthServiceWorkerRequestEligible } = await import('@/lib/authServiceWorker');
    const productionNavigation = createRequest('https://statly.example/dashboard', undefined, {
      destination: 'document',
      mode: 'navigate',
    });
    const localNavigation = createRequest('http://127.0.0.1:3000/dashboard', undefined, {
      destination: 'document',
      mode: 'navigate',
    });

    expect(isAuthServiceWorkerRequestEligible(productionNavigation, 'https://statly.example')).toBe(
      true
    );
    expect(isAuthServiceWorkerRequestEligible(localNavigation, 'http://127.0.0.1:3000')).toBe(true);
  });

  it.each([
    createRequest('https://statly.example/api/leagues'),
    createRequest('https://statly.example/dashboard?_rsc=route-state'),
    createRequest('https://statly.example/dashboard', { headers: { RSC: '1' } }),
    createRequest('https://statly.example/dashboard', {
      headers: { Accept: 'text/x-component' },
    }),
    createRequest('https://statly.example/dashboard', {
      method: 'POST',
      headers: { 'Next-Action': 'action-id' },
    }),
  ])('allows an eligible application transport request', async (request) => {
    const { isAuthServiceWorkerRequestEligible } = await import('@/lib/authServiceWorker');

    expect(isAuthServiceWorkerRequestEligible(request, 'https://statly.example')).toBe(true);
  });

  it.each([
    createRequest('https://other.example/api/leagues'),
    createRequest('http://statly.example/api/leagues'),
    createRequest('https://statly.example/api/leagues', {
      headers: { Authorization: 'Bearer existing-token' },
    }),
    createRequest('https://statly.example/_next/static/chunks/app.js?_rsc=route-state', {
      headers: { RSC: '1' },
    }),
    createRequest('https://statly.example/images/logo.svg', undefined, {
      destination: 'image',
    }),
    createRequest('https://statly.example/reports/season.pdf', undefined, {
      destination: 'document',
      mode: 'navigate',
    }),
    createRequest('https://statly.example/search?q=afl'),
  ])('rejects a request outside the identity transport boundary', async (request) => {
    const { isAuthServiceWorkerRequestEligible } = await import('@/lib/authServiceWorker');

    expect(isAuthServiceWorkerRequestEligible(request, 'https://statly.example')).toBe(false);
  });
});

describe('ensureAuthServiceWorkerReady', () => {
  const serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (serviceWorkerDescriptor) {
      Object.defineProperty(navigator, 'serviceWorker', serviceWorkerDescriptor);
    } else {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
  });

  function installServiceWorkerContainer(options?: {
    controlled?: boolean;
    updatePending?: boolean;
    registrationDelayMs?: number;
    registrationError?: Error;
    registrationPending?: boolean;
  }) {
    const eventTarget = new EventTarget();
    const activeWorker = {
      postMessage: vi.fn(),
      scriptURL: new URL('/auth-service-worker.js', window.location.href).href,
    };
    const registration = {
      active: activeWorker,
      installing: options?.updatePending ? { postMessage: vi.fn() } : null,
      waiting: null,
    } as unknown as ServiceWorkerRegistration;
    const container = {
      controller: options?.controlled ? activeWorker : null,
      register: options?.registrationError
        ? vi.fn().mockRejectedValue(options.registrationError)
        : options?.registrationPending
          ? vi.fn().mockReturnValue(new Promise(() => undefined))
          : options?.registrationDelayMs
            ? vi.fn().mockImplementation(
                () =>
                  new Promise((resolve) => {
                    setTimeout(() => resolve(registration), options.registrationDelayMs);
                  })
              )
            : vi.fn().mockResolvedValue(registration),
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    } as unknown as ServiceWorkerContainer;

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: container,
    });

    return { activeWorker, container };
  }

  it('refreshes a stale expected worker before resolving readiness', async () => {
    const { container } = installServiceWorkerContainer({ controlled: true, updatePending: true });
    const { ensureAuthServiceWorkerReady } = await import('@/lib/authServiceWorker');
    let settled = false;
    const ready = ensureAuthServiceWorkerReady().then(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(container.register).toHaveBeenCalledWith('/auth-service-worker.js', { scope: '/' });
    });
    expect(settled).toBe(false);

    Object.assign(container, {
      controller: { scriptURL: new URL('/auth-service-worker.js', window.location.href).href },
    });
    container.dispatchEvent(new Event('controllerchange'));

    await expect(ready).resolves.toBeUndefined();
  });

  it('registers at root scope and waits until the worker controls the page', async () => {
    const { activeWorker, container } = installServiceWorkerContainer();
    const { ensureAuthServiceWorkerReady } = await import('@/lib/authServiceWorker');
    const ready = ensureAuthServiceWorkerReady();

    await vi.waitFor(() => {
      expect(container.register).toHaveBeenCalledWith('/auth-service-worker.js', { scope: '/' });
      expect(activeWorker.postMessage).toHaveBeenCalledWith({ type: 'statly:claim-auth-clients' });
    });

    Object.assign(container, {
      controller: { scriptURL: new URL('/auth-service-worker.js', window.location.href).href },
    });
    container.dispatchEvent(new Event('controllerchange'));

    await expect(ready).resolves.toBeUndefined();
  });

  it('deduplicates concurrent readiness attempts', async () => {
    const { container } = installServiceWorkerContainer();
    const { ensureAuthServiceWorkerReady } = await import('@/lib/authServiceWorker');

    const first = ensureAuthServiceWorkerReady();
    const second = ensureAuthServiceWorkerReady();
    expect(first).toBe(second);

    await vi.waitFor(() => expect(container.register).toHaveBeenCalledTimes(1));
    Object.assign(container, {
      controller: { scriptURL: new URL('/auth-service-worker.js', window.location.href).href },
    });
    container.dispatchEvent(new Event('controllerchange'));

    await expect(first).resolves.toBeUndefined();
    expect(container.register).toHaveBeenCalledTimes(1);
  });

  it('surfaces registration failures as typed recoverable errors', async () => {
    const registrationError = new Error('registration denied');
    installServiceWorkerContainer({ registrationError });
    const { AuthServiceWorkerError, ensureAuthServiceWorkerReady } = await import(
      '@/lib/authServiceWorker'
    );

    const error = await ensureAuthServiceWorkerReady().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AuthServiceWorkerError);
    expect(error).toMatchObject({ code: 'registration-failed', recoverable: true });
    expect((error as Error).cause).toBe(registrationError);
  });

  it('times out with a typed recoverable error when no controller takes ownership', async () => {
    vi.useFakeTimers();
    installServiceWorkerContainer();
    const { AuthServiceWorkerError, ensureAuthServiceWorkerReady } = await import(
      '@/lib/authServiceWorker'
    );
    const ready = ensureAuthServiceWorkerReady();
    const outcome = ready.catch((reason: unknown) => reason);

    await vi.advanceTimersByTimeAsync(10_000);
    const error = await outcome;

    expect(error).toBeInstanceOf(AuthServiceWorkerError);
    expect(error).toMatchObject({ code: 'controller-timeout', recoverable: true });
  });

  it('shares one timeout budget across registration and controller ownership', async () => {
    vi.useFakeTimers();
    installServiceWorkerContainer({ registrationDelayMs: 6_000 });
    const { AuthServiceWorkerError, ensureAuthServiceWorkerReady } = await import(
      '@/lib/authServiceWorker'
    );
    const outcome = ensureAuthServiceWorkerReady().catch((reason: unknown) => reason);

    await vi.advanceTimersByTimeAsync(6_000);
    await vi.advanceTimersByTimeAsync(4_000);
    const error = await outcome;

    expect(error).toBeInstanceOf(AuthServiceWorkerError);
    expect(error).toMatchObject({ code: 'controller-timeout', recoverable: true });
  });

  it('times out with a typed recoverable error when registration does not settle', async () => {
    vi.useFakeTimers();
    installServiceWorkerContainer({ registrationPending: true });
    const { AuthServiceWorkerError, ensureAuthServiceWorkerReady } = await import(
      '@/lib/authServiceWorker'
    );
    const outcome = ensureAuthServiceWorkerReady().catch((reason: unknown) => reason);

    await vi.advanceTimersByTimeAsync(10_000);
    const error = await outcome;

    expect(error).toBeInstanceOf(AuthServiceWorkerError);
    expect(error).toMatchObject({ code: 'registration-timeout', recoverable: true });
  });

  it('rejects unsupported browsers with a typed recoverable error', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    const { AuthServiceWorkerError, ensureAuthServiceWorkerReady } = await import(
      '@/lib/authServiceWorker'
    );

    const error = await ensureAuthServiceWorkerReady().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AuthServiceWorkerError);
    expect(error).toMatchObject({ code: 'unsupported', recoverable: true });
  });
});
