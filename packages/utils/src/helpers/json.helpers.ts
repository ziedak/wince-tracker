
export function serialize(value: unknown): string {
  return JSON.stringify(value);
}

export function deserialize<T>(raw: string): T | string {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw;
  }
}
