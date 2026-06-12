import { StoreKind, createMultiStore } from './stores/MultiStorage';
export type { IStore } from './stores/BaseStorage';

export * from './DurableQueue';
export { createMultiStore } from './stores/MultiStorage';
/** @alias createMultiStore — kept for backwards compatibility with @wince/web */
export const createStore = createMultiStore;
export const STORAGE_STRATEGIES: StoreKind[] = [
  'localStorage',
  'sessionStorage',
  'cookie',
  'memory',
];
export { BaseStorage } from './stores/BaseStorage';

export const LocalStore = createMultiStore({ strategies: ['localStorage'] });
export const SessionStore = createMultiStore({
  strategies: ['sessionStorage'],
});
export const MemoryStore = createMultiStore({ strategies: ['memory'] });
export const CookieStore = createMultiStore({
  strategies: ['cookie'],
  cookieOptions: { crossSubdomain: false },
});
