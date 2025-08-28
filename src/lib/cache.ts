/**
 * In-memory cache implementation with TTL support
 * For production, consider using Redis or similar external cache
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  maxSize?: number; // Maximum number of entries
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private defaultTTL: number;
  private maxSize: number;

  constructor(options: CacheOptions = {}) {
    this.defaultTTL = options.ttl || 5 * 60 * 1000; // 5 minutes default
    this.maxSize = options.maxSize || 1000; // 1000 entries max
  }

  set<T>(key: string, data: T, ttl?: number): void {
    // Clean up expired entries if cache is getting full
    if (this.cache.size >= this.maxSize) {
      this.cleanup();
    }

    // If still at max size, remove oldest entry
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    };

    this.cache.set(key, entry);
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
  }

  size(): number {
    this.cleanup(); // Clean up before returning size
    return this.cache.size;
  }

  getStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.size(),
      maxSize: this.maxSize,
    };
  }
}

// Global cache instances
const apiCache = new MemoryCache({ ttl: 5 * 60 * 1000, maxSize: 500 }); // 5 minutes for API responses
const dataCache = new MemoryCache({ ttl: 15 * 60 * 1000, maxSize: 200 }); // 15 minutes for data queries
const userCache = new MemoryCache({ ttl: 30 * 60 * 1000, maxSize: 100 }); // 30 minutes for user data

export { apiCache, dataCache, userCache };

// Cache key generators
export function generateCacheKey(prefix: string, params: Record<string, any>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${JSON.stringify(params[key])}`)
    .join('&');
  
  return `${prefix}:${sortedParams}`;
}

export function generateApiCacheKey(endpoint: string, params: Record<string, any> = {}): string {
  return generateCacheKey(`api:${endpoint}`, params);
}

// Cache decorators/helpers
export function withCache<T>(
  cache: MemoryCache,
  key: string,
  fetcher: () => Promise<T>,
  ttl?: number
): Promise<T> {
  const cached = cache.get<T>(key);
  
  if (cached !== null) {
    return Promise.resolve(cached);
  }

  return fetcher().then(data => {
    cache.set(key, data, ttl);
    return data;
  });
}

export function withApiCache<T>(
  endpoint: string,
  params: Record<string, any>,
  fetcher: () => Promise<T>,
  ttl?: number
): Promise<T> {
  const key = generateApiCacheKey(endpoint, params);
  return withCache(apiCache, key, fetcher, ttl);
}

// Cache invalidation helpers
export function invalidateCache(pattern: string): void {
  [apiCache, dataCache, userCache].forEach(cache => {
    // Since we don't have pattern matching in our simple cache,
    // we'll need to iterate through keys
    const keysToDelete: string[] = [];
    
    // This is a simplified approach - in production you'd want a more sophisticated pattern matching
    for (const key of (cache as any).cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => cache.delete(key));
  });
}

export function invalidateApiCache(endpoint: string): void {
  invalidateCache(`api:${endpoint}`);
}

export function invalidateUserCache(userId: string): void {
  invalidateCache(`user:${userId}`);
}

// Next.js route cache helpers (no-op outside Next runtime)
export async function revalidateTags(tags: string[]): Promise<void> {
  try {
    const { revalidateTag } = await import('next/cache');
    await Promise.all(tags.map(tag => revalidateTag(tag)));
  } catch {
    // Swallow errors when next/cache is unavailable
  }
}

export async function revalidatePlayersTags(): Promise<void> {
  return revalidateTags(['players', 'players:list', 'player-stats']);
}

// Periodic cleanup
if (typeof window !== 'undefined') {
  // Run cleanup every 5 minutes on the client
  setInterval(() => {
    apiCache.cleanup();
    dataCache.cleanup();
    userCache.cleanup();
  }, 5 * 60 * 1000);
}

// Cache middleware for API routes
export function cacheMiddleware(ttl?: number) {
  return function <T>(
    target: any,
    propertyName: string,
    descriptor: TypedPropertyDescriptor<(...args: any[]) => Promise<T>>
  ) {
    const method = descriptor.value!;
    
    descriptor.value = async function (...args: any[]): Promise<T> {
      const cacheKey = generateCacheKey(`method:${propertyName}`, { args });
      
      return withCache(apiCache, cacheKey, () => method.apply(this, args), ttl);
    };
  };
}

export default { apiCache, dataCache, userCache };
