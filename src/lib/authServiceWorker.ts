const AUTH_SERVICE_WORKER_PATH = '/auth-service-worker.js';
const AUTH_SERVICE_WORKER_SCOPE = '/';
const AUTH_SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;

const STATIC_PATH_PREFIXES = ['/_next/', '/assets/', '/fonts/', '/icons/', '/images/'];
const STATIC_ASSET_EXTENSION =
  /\.(?:avif|bmp|css|csv|eot|gif|ico|jpe?g|js|json|map|mjs|otf|pdf|png|svg|ttf|txt|webmanifest|webp|woff2?|xml)$/i;
const STATIC_PATHS = new Set([
  AUTH_SERVICE_WORKER_PATH,
  '/favicon.ico',
  '/manifest.json',
  '/robots.txt',
  '/site.webmanifest',
  '/sitemap.xml',
]);

export type AuthServiceWorkerErrorCode =
  | 'insecure-context'
  | 'registration-failed'
  | 'registration-timeout'
  | 'controller-timeout'
  | 'unsupported';

export class AuthServiceWorkerError extends Error {
  readonly code: AuthServiceWorkerErrorCode;
  readonly recoverable = true;

  constructor(code: AuthServiceWorkerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthServiceWorkerError';
    this.code = code;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isSecureOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' || isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function isStaticAssetPath(pathname: string): boolean {
  return (
    STATIC_PATHS.has(pathname) ||
    STATIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    STATIC_ASSET_EXTENSION.test(pathname)
  );
}

/**
 * Defines the only request classes that may receive a Firebase ID token.
 * This function stays side-effect free so the browser and worker use the
 * same auditable policy and unit tests can exercise it directly.
 */
export function isAuthServiceWorkerRequestEligible(
  request: Request,
  serviceWorkerOrigin: string
): boolean {
  let requestUrl: URL;

  try {
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }

  const isApiRequest = requestUrl.pathname === '/api' || requestUrl.pathname.startsWith('/api/');

  if (
    requestUrl.origin !== serviceWorkerOrigin ||
    !isSecureOrigin(serviceWorkerOrigin) ||
    request.headers.has('Authorization') ||
    (!isApiRequest && isStaticAssetPath(requestUrl.pathname))
  ) {
    return false;
  }

  if (request.destination && request.destination !== 'document') {
    return false;
  }

  if (request.mode === 'navigate') {
    return true;
  }

  if (isApiRequest) {
    return true;
  }

  const accept = request.headers.get('Accept') ?? '';
  return (
    request.headers.has('Next-Action') ||
    request.headers.get('RSC') === '1' ||
    accept.includes('text/x-component') ||
    requestUrl.searchParams.has('_rsc')
  );
}

let readinessInFlight: Promise<void> | null = null;

function expectedControllerUrl(): string {
  return new URL(AUTH_SERVICE_WORKER_PATH, window.location.href).href;
}

function hasExpectedController(container: ServiceWorkerContainer): boolean {
  return container.controller?.scriptURL === expectedControllerUrl();
}

function waitForExpectedController(container: ServiceWorkerContainer): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      container.removeEventListener('controllerchange', onControllerChange);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };

    const onControllerChange = () => {
      if (!hasExpectedController(container)) {
        return;
      }

      cleanup();
      resolve();
    };

    container.addEventListener('controllerchange', onControllerChange);
    timeoutId = setTimeout(() => {
      cleanup();
      reject(
        new AuthServiceWorkerError(
          'controller-timeout',
          'The authentication service worker did not take control of this page in time.'
        )
      );
    }, AUTH_SERVICE_WORKER_READY_TIMEOUT_MS);

    onControllerChange();
  });
}

function registerServiceWorker(
  container: ServiceWorkerContainer
): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(
        new AuthServiceWorkerError(
          'registration-timeout',
          'The authentication service worker registration did not complete in time.'
        )
      );
    }, AUTH_SERVICE_WORKER_READY_TIMEOUT_MS);

    void container.register(AUTH_SERVICE_WORKER_PATH, { scope: AUTH_SERVICE_WORKER_SCOPE }).then(
      (registration) => {
        clearTimeout(timeoutId);
        resolve(registration);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(
          new AuthServiceWorkerError(
            'registration-failed',
            'The authentication service worker could not be registered.',
            { cause: error }
          )
        );
      }
    );
  });
}

async function registerAndWaitForController(): Promise<void> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    throw new AuthServiceWorkerError(
      'unsupported',
      'Authentication service workers are only available in a browser.'
    );
  }

  if (!isSecureOrigin(window.location.origin)) {
    throw new AuthServiceWorkerError(
      'insecure-context',
      'Authentication requires HTTPS or a loopback development origin.'
    );
  }

  if (!('serviceWorker' in navigator)) {
    throw new AuthServiceWorkerError(
      'unsupported',
      'This browser does not support authentication service workers.'
    );
  }

  const container = navigator.serviceWorker;
  if (hasExpectedController(container)) {
    return;
  }

  const registration = await registerServiceWorker(container);

  if (hasExpectedController(container)) {
    return;
  }

  // An already-active worker normally claimed clients during activation. Ask
  // it to claim again to recover deterministically from an uncontrolled tab.
  registration.active?.postMessage({ type: 'statly:claim-auth-clients' });
  await waitForExpectedController(container);
}

/**
 * Registers the authentication service worker and resolves only after that
 * worker controls the current page. Concurrent callers share the same attempt;
 * failed attempts remain retryable and surface a typed recoverable error.
 */
export function ensureAuthServiceWorkerReady(): Promise<void> {
  if (readinessInFlight) {
    return readinessInFlight;
  }

  readinessInFlight = registerAndWaitForController().finally(() => {
    readinessInFlight = null;
  });

  return readinessInFlight;
}
