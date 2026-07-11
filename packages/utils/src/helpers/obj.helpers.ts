export type JsonType =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonType }
  | Array<JsonType>
  | JsonType[];
import { isArray, isEmptyString, isObject, isPrimitive } from '../validation';

export function deepSortKeys(value: JsonType): JsonType {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (isArray(value)) {
    return value.map(deepSortKeys);
  }

  // value is a plain object here
  return Object.keys(value)
    .sort()
    .reduce((acc: { [key: string]: JsonType }, key) => {
      acc[key] = deepSortKeys((value as { [key: string]: JsonType })[key]);
      return acc;
    }, {});
}

export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (isArray(obj)) {
    (obj as unknown[]).forEach((item) => deepFreeze(item));
    return Object.freeze(obj) as T;
  }

  Object.keys(obj as Record<string, unknown>).forEach((key) => {
    const v = (obj as Record<string, unknown>)[key];
    deepFreeze(v);
  });

  return Object.freeze(obj);
}

export function deepMerge<T>(target: T, source: Partial<T>): T {
  if (source === null || typeof source !== 'object') {
    return target;
  }

  // If either side isn't a plain object, prefer source
  if (!isObject(source) || !isObject(target)) {
    return deepClone(source as unknown as T) as unknown as T;
  }

  const merged: { [key: string]: unknown } = {
    ...(target as Record<string, unknown>),
  };

  Object.keys(source as Record<string, unknown>).forEach((key) => {
    const sourceValue = (source as Record<string, unknown>)[key];
    const targetValue = (target as Record<string, unknown>)[key];

    if (isObject(sourceValue) && isObject(targetValue)) {
      merged[key] = deepMerge(
        targetValue,
        sourceValue as Partial<typeof targetValue>,
      );
    } else {
      merged[key] = deepClone(sourceValue as unknown) as unknown;
    }
  });

  return merged as T;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (isPrimitive(a) || isPrimitive(b)) return a === b;

  if (isArray(a) !== isArray(b)) return false;

  if (isArray(a) && isArray(b)) {
    const aa = a as unknown[];
    const bb = b as unknown[];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (!deepEqual(aa[i], bb[i])) return false;
    }
    return true;
  }

  if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (
        !bKeys.includes(key) ||
        !deepEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        )
      )
        return false;
    }
    return true;
  }

  return false;
}
// get value from object by path
export function getValueByPath(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  if (isEmptyString(path)) return undefined;
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (!isObject(current) || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// set value in object by path
export function setValueByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  if (isEmptyString(path)) return;
  const keys = path.split('.');
  let current: unknown = obj;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (i === keys.length - 1) {
      if (isObject(current)) {
        (current as Record<string, unknown>)[key] = value;
      }
    } else {
      if (!isObject(current)) return;

      if (
        !(key in current) ||
        !isObject((current as Record<string, unknown>)[key])
      ) {
        (current as Record<string, unknown>)[key] = {};
      }
      current = (current as Record<string, unknown>)[key];
    }
  }
}
export function smartClone<T>(obj: T, seenObjects = new WeakMap()): T {
  // Handle primitive types and functions
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Handle Date objects
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as any;
  }

  // Handle RegExp objects
  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as any;
  }

  // Handle circular references
  if (seenObjects.has(obj as any)) {
    return seenObjects.get(obj as any);
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    const copy: any[] = [];
    seenObjects.set(obj as any, copy);

    for (let i = 0; i < obj.length; i++) {
      copy[i] = smartClone(obj[i], seenObjects);
    }

    return copy as any;
  }

  // Handle objects
  const copy: any = {};
  seenObjects.set(obj as any, copy);

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      copy[key] = smartClone(obj[key], seenObjects);
    }
  }

  return copy as T;
}
export function deepClone<T>(obj: T): T {
  try {
    return smartClone(obj);
  } catch (error) {
    console.error('Deep clone failed', error);
    // Fallback to JSON stringify/parse
    return JSON.parse(JSON.stringify(obj)) as T;
  }
}