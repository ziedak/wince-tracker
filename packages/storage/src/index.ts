import { StoreKind } from '@wince/types';
import { CookieStoreOptions } from './stores/CookieStore';
import { createMultiStorage } from './stores/MultiStorage';

export { DurableQueue, type PersistedEvent } from './DurableQueue';
export { createMultiStorage } from './stores/MultiStorage';

export const STORAGE_STRATEGIES: StoreKind[] = [
  'localStorage',
  'sessionStorage',
  'cookie',
  'memory'
];
export { BaseStorage } from './stores/BaseStorage';

export const LocalStore = createMultiStorage({ strategies: ['localStorage'] });
export const SessionStore = createMultiStorage({
  strategies: ['sessionStorage']
});
export const MemoryStore = createMultiStorage({ strategies: ['memory'] });

export { getRootDomain, resetRootDomainCache } from './stores/CookieStore';
export type { CookieStoreOptions } from './stores/CookieStore';
export const CookieStore = (cookieOptions?: CookieStoreOptions) =>
  createMultiStorage({
    strategies: ['cookie'],
    cookieOptions: { crossSubdomain: false, ...cookieOptions }
  });
