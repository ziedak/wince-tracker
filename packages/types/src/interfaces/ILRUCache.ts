export interface ILRUCache {
  size: number;
  has(key: string): boolean;
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): boolean;
  clear(): void;
}
