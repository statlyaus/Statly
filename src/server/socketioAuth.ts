type SocketHandshakeAuth = unknown;

type AuthorizeSocketHandshakeInput = {
  authorization?: string | string[];
  handshakeAuth?: SocketHandshakeAuth;
  environment: string;
  validateAuthToken: (token: string) => Promise<string | null | undefined>;
};

type SocketAuthMiddlewareSocket = {
  handshake: {
    headers: Record<string, string | string[] | undefined>;
    auth?: SocketHandshakeAuth;
  };
  data: Record<string, unknown>;
};

type SocketAuthMiddlewareOptions = {
  environment: string;
  validateAuthToken: (token: string) => Promise<string | null | undefined>;
  onAuthFailure?: () => void;
  onObserved?: (outcome: SocketAuthResult['outcome'], durationSeconds: number) => void;
};

type SocketAuthResult =
  | { ok: true; outcome: 'ok'; userId: string }
  | { ok: true; outcome: 'dev-noauth' }
  | { ok: false; outcome: 'noauth' | 'invauth'; error: string };

function readAuthPayloadToken(handshakeAuth: SocketHandshakeAuth): string | null {
  if (!handshakeAuth || typeof handshakeAuth !== 'object') return null;
  const auth = handshakeAuth as { token?: unknown; authToken?: unknown };
  const token = typeof auth.token === 'string' ? auth.token.trim() : '';
  if (token) return token;
  const legacyToken = typeof auth.authToken === 'string' ? auth.authToken.trim() : '';
  return legacyToken || null;
}

export function getSocketBearerToken(input: {
  authorization?: string | string[];
  handshakeAuth?: SocketHandshakeAuth;
}): string | null {
  const authorization = Array.isArray(input.authorization)
    ? input.authorization[0]
    : input.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }

  return readAuthPayloadToken(input.handshakeAuth);
}

export async function authorizeSocketHandshake(
  input: AuthorizeSocketHandshakeInput
): Promise<SocketAuthResult> {
  const token = getSocketBearerToken({
    authorization: input.authorization,
    handshakeAuth: input.handshakeAuth,
  });

  if (!token) {
    if (input.environment !== 'production') {
      return { ok: true, outcome: 'dev-noauth' };
    }
    return {
      ok: false,
      error: 'Authentication required',
      outcome: 'noauth',
    };
  }

  const userId = await input.validateAuthToken(token);
  if (!userId) {
    return {
      ok: false,
      error: 'Authentication required',
      outcome: 'invauth',
    };
  }

  return { ok: true, outcome: 'ok', userId };
}

export function createSocketAuthMiddleware(options: SocketAuthMiddlewareOptions) {
  return async (
    socket: SocketAuthMiddlewareSocket,
    next: (error?: Error) => void
  ): Promise<void> => {
    const startedAt = Date.now();
    const authResult = await authorizeSocketHandshake({
      authorization: socket.handshake.headers.authorization,
      handshakeAuth: socket.handshake.auth,
      environment: options.environment,
      validateAuthToken: options.validateAuthToken,
    });

    if (!authResult.ok) {
      options.onAuthFailure?.();
      options.onObserved?.(authResult.outcome, (Date.now() - startedAt) / 1000);
      next(new Error(authResult.error));
      return;
    }

    if (authResult.outcome === 'ok') {
      socket.data.authenticatedUserId = authResult.userId;
    }

    next();
  };
}
