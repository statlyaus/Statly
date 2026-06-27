const PLACEHOLDER_REDIS_VALUES = new Set([
  'your-production-redis-host',
  'YOUR_PRODUCTION_REDIS_PASSWORD',
  'your-redis-host',
  'your-redis-password',
  'redis-host',
  'redis-password',
]);

export function isPlaceholderRedisValue(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return (
    PLACEHOLDER_REDIS_VALUES.has(normalized) ||
    normalized.startsWith('your-production-') ||
    normalized.startsWith('YOUR_PRODUCTION_')
  );
}

export function hasPlaceholderRedisConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return [
    env.REDIS_URL,
    env.REDIS_HOST,
    env.REDIS_USERNAME,
    env.REDIS_PASSWORD,
    env.REDIS_CLUSTER_NODES,
  ].some(isPlaceholderRedisValue);
}

export function shouldDisableRedisClients(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NEXT_PHASE === 'phase-production-build' ||
    env.REDIS_DISABLED === '1' ||
    hasPlaceholderRedisConfig(env)
  );
}
