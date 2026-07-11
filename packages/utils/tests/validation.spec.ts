import {
  isArray,
  isAsyncFunction,
  isBigInt,
  isBlob,
  isBoolean,
  isDate,
  isEmptyArray,
  isEmptyObject,
  isEmptyString,
  isError,
  isEvent,
  isFiniteNumber,
  isFile,
  isFormData,
  isFunction,
  isInRange,
  isInstanceOf,
  isInteger,
  isIntegerString,
  isMap,
  isNull,
  isNullish,
  isNumber,
  isObject,
  isPositiveInteger,
  isPrimitive,
  isPromise,
  isRegExp,
  isSet,
  isString,
  isSymbol,
  isUndefined,
  isURL,
  isWeakMap,
  isWeakSet,
  validatePassword,
  validateEmail
} from '../src/validation.js';

describe('utils/validation', () => {
  it('detects primitive-like values and simple containers', () => {
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean('true')).toBe(false);
    expect(isNumber(42)).toBe(true);
    expect(isNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(42)).toBe(true);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isInteger(3)).toBe(true);
    expect(isInteger(3.14)).toBe(false);
    expect(isPositiveInteger(3)).toBe(true);
    expect(isPositiveInteger(0)).toBe(false);
    expect(isBigInt(1n)).toBe(true);
    expect(isBigInt(1)).toBe(false);
    expect(isIntegerString('42')).toBe(true);
    expect(isIntegerString('-42')).toBe(true);
    expect(isIntegerString('4.2')).toBe(false);
    expect(isInRange(5, 1, 10)).toBe(true);
    expect(isInRange(5, 1, 10, false)).toBe(true);
    expect(isInRange(1, 1, 10, false)).toBe(false);
    expect(isString('hello')).toBe(true);
    expect(isArray([])).toBe(true);
    expect(isEmptyArray([])).toBe(true);
    expect(isEmptyArray([1])).toBe(false);
    expect(isSet(new Set())).toBe(true);
    expect(isWeakMap(new WeakMap())).toBe(true);
    expect(isWeakSet(new WeakSet())).toBe(true);
    expect(isMap(new Map())).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
    expect(isEmptyObject({})).toBe(true);
    expect(isError(new Error('boom'))).toBe(true);
    expect(isDate(new Date('2024-01-01T00:00:00.000Z'))).toBe(true);
    expect(isFunction(() => undefined)).toBe(true);
    expect(isNull(null)).toBe(true);
    expect(isUndefined(undefined)).toBe(true);
    expect(isEmptyString('   ')).toBe(true);
    expect(isNullish(null)).toBe(true);
    expect(isNullish(undefined)).toBe(true);
    expect(isSymbol(Symbol('x'))).toBe(true);
    expect(isPrimitive('x')).toBe(true);
    expect(isPrimitive({})).toBe(false);
    expect(validateEmail('user@example.com')).toBe(true);
    expect(validateEmail('not-an-email')).toBe(false);
    expect(validatePassword('Passw0rd')).toBe(true);
    expect(validatePassword('short')).toBe(false);
  });

  it('detects browser-like objects and promise shapes', () => {
    const formData = new FormData();
    const blob = new Blob(['x'], { type: 'text/plain' });
    const file = new File(['x'], 'test.txt', { type: 'text/plain' });
    const url = new URL('https://example.com');
    const regexp = /abc/;

    expect(isFormData(formData)).toBe(true);
    expect(isFile(file)).toBe(true);
    expect(isBlob(blob)).toBe(true);
    expect(isURL(url)).toBe(true);
    expect(isRegExp(regexp)).toBe(true);
    expect(isPromise(Promise.resolve('ok'))).toBe(true);
    expect(
      isPromise({
        then: () => undefined,
        catch: () => undefined
      })
    ).toBe(true);
    expect(isPromise({ then: () => undefined })).toBe(false);
    async function sampleAsyncFunction() {
      return 'ok';
    }
    expect(isAsyncFunction(sampleAsyncFunction)).toBe(true);
    expect(isEvent(new Event('test'))).toBe(true);
    expect(isEvent({})).toBe(false);
  });

  it('checks instanceof and nullish object edge cases', () => {
    class Example {}

    expect(isInstanceOf(new Example(), Example)).toBe(true);
    expect(isObject(null)).toBe(false);
    expect(isEmptyArray('not-an-array')).toBe(false);
    expect(isEmptyObject({ a: 1 })).toBe(false);
    expect(isFiniteNumber('12' as unknown)).toBe(false);
    expect(isFunction(null)).toBe(false);
    expect(isInRange('12' as unknown, 0, 20)).toBe(false);
  });
});
