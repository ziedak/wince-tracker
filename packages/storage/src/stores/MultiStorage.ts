// ===========================================================================
// IStore — common interface for all storage strategies
// ===========================================================================

import { BaseStorage, IStore } from './BaseStorage';
import { CookieStoreOptions, CookieStore } from './CookieStore';

export type StoreKind = 'localStorage' | 'sessionStorage' | 'cookie' | 'memory';
export const STORAGE_STRATEGIES: StoreKind[] = [
  'localStorage',
  'sessionStorage',
  'cookie',
  'memory',
];
export interface CreateStoreOptions {
  strategies?: StoreKind[];
  cookieOptions?: CookieStoreOptions;
}
export class MultiStorage implements IStore {
  private readonly stores: Map<StoreKind, IStore> = new Map();
  private readonly strategies: StoreKind[];
  private readonly cookieOptions?: CookieStoreOptions;

  constructor(options: CreateStoreOptions) {
    this.strategies = options.strategies ?? STORAGE_STRATEGIES;
    this.cookieOptions = options.cookieOptions;
    this.initializeStores();
  }
  private initializeStores() {
    for (const kind of this.strategies) {
      let store: IStore;

      switch (kind) {
        case 'localStorage':
          store = new BaseStorage(localStorage);
          break;
        case 'sessionStorage':
          store = new BaseStorage(sessionStorage);
          break;
        case 'cookie':
          store = new CookieStore(this.cookieOptions);
          break;
        case 'memory':
          store = new BaseStorage(); // always available — end of fallback
          break;
        default:
          continue; // skip unknown strategy
      }

      if (store.isAvailable()) this.stores.set(kind, store);
    }
    if (this.stores.size === 0) {
      this.stores.set('memory', new BaseStorage()); // ensure at least memory store
    }
  }
  isAvailable(): boolean {
    for (const store of this.stores.values()) {
      if (store.isAvailable()) return true;
    }
    return false;
  }
  availableStoreList(): Record<string, boolean> {
    const availability: Record<string, boolean> = {};
    this.stores.forEach((st, kind) => {
      availability[kind] = st.isAvailable();
    });
    return availability;
  }

  refreshKey(
    key: string,
    updater: (current: string | undefined | null) => string,
  ): void {
    this.stores.forEach((store) => {
      store.refreshKey(key, updater);
    });
  }
  get<T>(key: string): T | undefined {
    for (const store of this.stores.values()) {
      const value = store.get<T>(key);
      if (value !== undefined) return value; // early return on first hit
    }
    return undefined;
  }
  set(key: string, value: unknown): void {
    this.stores.forEach((store) => {
      store.set(key, value);
    });
  }
  delete(key: string): void {
    this.stores.forEach((store) => {
      store.delete(key);
    });
  }
  clear(prefix?: string): void {
    this.stores.forEach((store) => {
      store.clear(prefix);
    });
  }
  flush(): void {
    this.stores.forEach((store) => {
      store.flush();
    });
  }
}
// Factory function for creating a MultiStorage with specified strategies and options.
/**
 * Creates a MultiStorage instance with the given options
 * the order of strategies determines the fallback sequence (default is STORAGE_STRATEGIES)
 * the options include:
 * - strategies: an optional array of storage strategies to use (defaults to STORAGE_STRATEGIES)
 * - cookieOptions: optional configuration for the CookieStore strategy
 *
 * The MultiStorage will attempt to use the provided strategies in order, falling back to the next if one is unavailable.
 * @param opts
 * @returns
 */
export function createMultiStore(opts: CreateStoreOptions = {}): IStore {
  const storageOptions = {
    strategies: opts.strategies ?? STORAGE_STRATEGIES,
    cookieOptions: opts.cookieOptions ?? { crossSubdomain: false },
  };
  return new MultiStorage(storageOptions);
}
