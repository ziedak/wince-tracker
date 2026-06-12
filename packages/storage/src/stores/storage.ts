// ===========================================================================
// IStore — common interface for all storage strategies
// ===========================================================================

import { BaseStorage, IStore } from './BaseStorage';
import { CookieStoreOptions, CookieStore } from './CookieStore';





export type StoreKind = 'localStorage' | 'sessionStorage' | 'cookie' | 'memory';

export interface CreateStoreOptions {
  strategies?: StoreKind[];
  cookieOptions?: CookieStoreOptions;
}

export function createStore(opts: CreateStoreOptions = {}): IStore {
  const order = opts.strategies ?? ['localStorage', 'memory'];

  for (const kind of order) {
    let store: IStore;

    switch (kind) {
      case 'localStorage':
        store = new BaseStorage(localStorage);
        break;
      case 'sessionStorage':
        store = new BaseStorage(sessionStorage);
        break;
      case 'cookie':
        store = new CookieStore(opts.cookieOptions);
        break;
      case 'memory':
        return new BaseStorage(); // always available — end of fallback
    }

    if (store.isAvailable()) return store;
  }

  return new BaseStorage();
}
