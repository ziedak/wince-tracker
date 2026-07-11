export const isBoolean = (value: unknown): value is boolean => {
  return typeof value === 'boolean';
};
export const isNumber = (value: unknown): value is number => {
  return typeof value === 'number' && !Number.isNaN(value);
};
export const isFiniteNumber = (value: unknown): value is number => {
  return isNumber(value) && Number.isFinite(value);
};
export const isInteger = (value: unknown): value is number => {
  return isNumber(value) && Number.isInteger(value);
};
export const isPositiveInteger = (value: unknown): value is number => {
  return isNumber(value) && Number.isInteger(value) && value > 0;
};
export const isBigInt = (value: unknown): value is bigint => {
  return typeof value === 'bigint';
};
export const isIntegerString = (value: unknown): value is string => {
  return (
    typeof value === 'string' &&
    /^-?\d+$/.test(value) &&
    !Number.isNaN(Number(value))
  );
};
export const isInRange = (
  value: unknown,
  min: number,
  max: number,
  inclusive = true,
): boolean => {
  if (!isNumber(value)) {
    return false;
  }
  return inclusive ? value >= min && value <= max : value > min && value < max;
};

export const isString = (value: unknown): value is string => {
  return typeof value === 'string';
};

export const isArray = (value: unknown): value is unknown[] => {
  return Array.isArray(value);
};
export const isEmptyArray = (value: unknown): boolean => {
  return isArray(value) && value.length === 0;
};
export const isSet = (value: unknown): value is Set<unknown> => {
  return value instanceof Set;
};
export const isWeakMap = (
  value: unknown,
): value is WeakMap<object, unknown> => {
  return value instanceof WeakMap;
};
export const isWeakSet = (value: unknown): value is WeakSet<object> => {
  return value instanceof WeakSet;
};

export const isMap = (value: unknown): value is Map<unknown, unknown> => {
  return value instanceof Map;
};
export const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};
export const isEmptyObject = (value: unknown): boolean => {
  return isObject(value) && Object.keys(value).length === 0;
};
export const isError = (value: unknown): value is Error => {
  return value instanceof Error;
};

export const isDate = (value: unknown): value is Date => {
  return value instanceof Date && !isNaN(value.getTime());
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const isFunction = (value: unknown): value is Function => {
  return typeof value === 'function';
};

export const isNull = (value: unknown): value is null => {
  return value === null;
};

export const isUndefined = (value: unknown): value is undefined => {
  return typeof value === 'undefined';
};

export const isEmptyString = (value: unknown): boolean => {
  return isString(value) && value.trim() === '';
}
export const isNullish = (x: unknown): x is null | undefined =>
  isUndefined(x) || isNull(x);
export const isSymbol = (value: unknown): value is symbol => {
  return typeof value === 'symbol';
};

export const isPrimitive = (
  value: unknown,
): value is string | number | boolean | symbol | bigint | null | undefined => {
  return (
    isString(value) ||
    isNumber(value) ||
    isBoolean(value) ||
    isSymbol(value) ||
    isBigInt(value) ||
    isNull(value) ||
    isUndefined(value)
  );
};

export const isFormData = (x: unknown): x is FormData => {
  return x instanceof FormData;
};

export const isFile = (x: unknown): x is File => {
  return x instanceof File;
};
export const isBlob = (x: unknown): x is Blob => {
  return x instanceof Blob;
};
export const isURL = (x: unknown): x is URL => {
  return x instanceof URL;
};
export const isRegExp = (x: unknown): x is RegExp => {
  return x instanceof RegExp;
};
export const isPromise = (x: unknown): x is Promise<unknown> => {
  return (
    x instanceof Promise ||
    (x !== null &&
      typeof x === 'object' &&
      typeof (x as Promise<unknown>).then === 'function' &&
      typeof (x as Promise<unknown>).catch === 'function')
  );
};
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const isAsyncFunction = (x: unknown): x is Function => {
  return (
    isFunction(x) &&
    Object.prototype.toString.call(x) === '[object AsyncFunction]'
  );
};

export const isInstanceOf = <T>(
  value: unknown,
  constructor: new (...args: any[]) => T,
): value is T => {
  return value instanceof constructor;
};

export function isEvent(candidate: unknown): candidate is Event {
  return typeof Event !== 'undefined' && isInstanceOf(candidate, Event);
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validatePassword(password: string): boolean {
  // Password must be at least 8 characters long and contain at least one number and one letter
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
  return passwordRegex.test(password);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Returns true when `v` is a lowercase, hyphenated UUID string. */
export function isValidUuidv4(v: unknown): v is string {
  return isString(v) && UUID_RE.test(v);
}