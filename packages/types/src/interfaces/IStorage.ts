export type StoreKind = 'localStorage' | 'sessionStorage' | 'cookie' | 'memory';
export interface IStorage {
  getStrategy(): StoreKind|StoreKind[];
  isAvailable(): boolean;
  refreshKey(
    key: string,
    updater: (current: string | undefined | null) => string,
  ): void;
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  clear(prefix?: string): void;
  /** Force all pending writes immediately (e.g. on pagehide). Optional. */
  flush(): void;
}