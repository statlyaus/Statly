type SocketMutationSocket = {
  id: string;
  emit(event: 'draft:error', payload: { error: string }): void;
};

type SocketMutationLogger = {
  warn(message: string, context: Record<string, unknown>): void;
};

type RejectSocketMutationCommandInput = {
  socket: SocketMutationSocket;
  logger: SocketMutationLogger;
  incCounter?: (metricName: string) => void;
  metricName?: string;
  logMessage: string;
  error: string;
  context?: Record<string, unknown>;
};

export function socketMutationContext(
  payload: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      invalidPayload: true,
      payloadType: payload === null ? 'null' : typeof payload,
    };
  }

  return keys.reduce<Record<string, unknown>>((context, key) => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      context[key] = (payload as Record<string, unknown>)[key];
    }

    return context;
  }, {});
}

export function rejectSocketMutationCommand(input: RejectSocketMutationCommandInput): void {
  if (input.metricName) {
    input.incCounter?.(input.metricName);
  }

  input.logger.warn(input.logMessage, {
    socketId: input.socket.id,
    ...(input.context ?? {}),
  });

  input.socket.emit('draft:error', {
    error: input.error,
  });
}
