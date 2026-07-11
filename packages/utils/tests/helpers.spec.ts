import { serialize, deserialize } from '../src/helpers/json.helpers.js';
import {
  setInRange,
  roundToDecimalPlaces,
  formatNumberWithCommas,
  parseNumberFromString,
  calculatePercentage
} from '../src/helpers/numeric.helpers.js';
import {
  deepSortKeys,
  deepFreeze,
  deepMerge,
  deepEqual,
  deepClone,
  getValueByPath,
  setValueByPath
} from '../src/helpers/obj.helpers.js';
import {
  capitalizeFirstLetter,
  camelCaseToKebabCase,
  kebabCaseToCamelCase,
  truncateString,
  reverseString,
  countOccurrences,
  isPalindrome,
  generateRandomString
} from '../src/helpers/string.helpers.js';

describe('utils/helpers', () => {
  it('deepSortKeys sorts object keys alphabetically', () => {
    expect(
      deepSortKeys({
        b: 1,
        a: { d: 4, c: 3 },
        e: [{ z: 1, y: 2 }]
      })
    ).toEqual({
      a: { c: 3, d: 4 },
      b: 1,
      e: [{ y: 2, z: 1 }]
    });
  });

  it('deepFreeze freezes nested objects and arrays', () => {
    const value = deepFreeze({
      nested: { count: 1 },
      items: [{ label: 'a' }]
    });

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.nested)).toBe(true);
    expect(Object.isFrozen(value.items)).toBe(true);
    expect(Object.isFrozen(value.items[0])).toBe(true);
  });

  it('deepMerge merges nested objects and preserves target values', () => {
    expect(
      deepMerge(
        {
          profile: { name: 'Ada', role: 'admin' },
          display: 'full',
          active: true
        },
        { profile: { role: 'editor', name: 'Ada' } }
      )
    ).toEqual({
      profile: { name: 'Ada', role: 'editor' },
      active: true,
      display: 'full'
    });
  });

  it('deepEqual compares arrays, objects, and primitives', () => {
    expect(deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(deepEqual(1, '1')).toBe(false);
  });

  it('getValueByPath and setValueByPath read and write nested values', () => {
    const value: Record<string, unknown> = {
      user: { profile: { name: 'Ada' } }
    };

    expect(getValueByPath(value, 'user.profile.name')).toBe('Ada');
    expect(getValueByPath(value, '')).toBeUndefined();

    setValueByPath(value, 'user.profile.role', 'admin');
    setValueByPath(value, 'user.preferences.theme', 'dark');

    expect(value).toEqual({
      user: {
        profile: { name: 'Ada', role: 'admin' },
        preferences: { theme: 'dark' }
      }
    });
  });

  it('deepClone copies complex values without sharing references', () => {
    const original: Record<string, unknown> & { self?: unknown } = {
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      pattern: /abc/gi,
      nested: [{ count: 1 }]
    };
    original.self = original;

    const cloned = deepClone(original);

    expect(cloned).not.toBe(original);
    expect(cloned.createdAt).toEqual(original.createdAt);
    expect(cloned.pattern).toEqual(original.pattern);
    expect(cloned.nested).toEqual(original.nested);
    expect((cloned as typeof original).self).toBe(cloned);
  });

  it('serializes and deserializes JSON values', () => {
    expect(serialize({ ok: true })).toBe('{"ok":true}');
    expect(deserialize<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
    expect(deserialize('not-json')).toBe('not-json');
  });

  it('string helpers handle common transformations and edge cases', () => {
    expect(capitalizeFirstLetter('hello')).toBe('Hello');
    expect(capitalizeFirstLetter('')).toBe('');
    expect(camelCaseToKebabCase('camelCaseValue')).toBe('camel-case-value');
    expect(kebabCaseToCamelCase('kebab-case-value')).toBe('kebabCaseValue');
    expect(truncateString('abcdef', 3)).toBe('abc...');
    expect(reverseString('abc')).toBe('cba');
    expect(countOccurrences('banana', 'an')).toBe(2);
    expect(countOccurrences('banana', '')).toBe(0);
    expect(isPalindrome('Never odd or even')).toBe(true);
    expect(isPalindrome('not a palindrome')).toBe(false);
    expect(generateRandomString(12)).toHaveLength(12);
  });

  it('numeric helpers clamp, parse, and format values', () => {
    expect(setInRange(5, 1, 10)).toBe(5);
    expect(setInRange(-2, 1, 10)).toBe(1);
    expect(setInRange(15, 1, 10, false)).toBe(10);
    expect(() => setInRange(Number.NaN, 1, 10)).toThrow('Value must be a valid number');
    expect(roundToDecimalPlaces(1.2345, 2)).toBe(1.23);
    expect(formatNumberWithCommas(1234567)).toBe('1,234,567');
    expect(parseNumberFromString('42.5')).toBe(42.5);
    expect(parseNumberFromString('not-a-number')).toBeNull();
    expect(calculatePercentage(25, 100)).toBe(25);
    expect(() => calculatePercentage(1, 0)).toThrow(
      'Part and total must be valid numbers, and total cannot be zero'
    );
  });

  it('deep helpers tolerate invalid path input', () => {
    const value: Record<string, unknown> = { existing: true };

    expect(getValueByPath(value, 'missing.path')).toBeUndefined();
    setValueByPath(value, '', 'ignored');
    expect(value).toEqual({ existing: true });
  });
});
