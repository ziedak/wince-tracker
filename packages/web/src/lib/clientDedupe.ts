import { LRUCache } from '@wince/cache';

/**
 * Create a dedupe cache for recent events.
 * Returns an LRUCache configured with sane defaults matching existing clients.
 */
export function createDedupe(maxSize = 50, ttlMs = 2_000) {
  return new LRUCache({ maxSize, ttlMs });
}
