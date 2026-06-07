import { deepSortKeys } from '.';

describe('utils/helpers', () => {
  it('deepSortKeys sorts object keys alphabetically', () => {
    expect(deepSortKeys({ b: 1, a: 2 })).toEqual({ a: 2, b: 1 });
  });
});
