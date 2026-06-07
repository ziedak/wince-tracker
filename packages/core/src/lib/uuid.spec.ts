import { uuidv4, uuidv7, isValidUuid } from './uuid';

describe('uuidv4', () => {
  it('returns a valid UUID string', () => {
    expect(isValidUuid(uuidv4())).toBe(true);
  });

  it('version nibble is "4"', () => {
    const id = uuidv4();
    expect(id[14]).toBe('4');
  });

  it('variant nibble is 8, 9, a, or b', () => {
    const id = uuidv4();
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('produces unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuidv4()));
    expect(ids.size).toBe(100);
  });
});

describe('uuidv7', () => {
  it('returns a valid UUID string', () => {
    expect(isValidUuid(uuidv7())).toBe(true);
  });

  it('version nibble is "7"', () => {
    const id = uuidv7();
    expect(id[14]).toBe('7');
  });

  it('variant nibble is 8, 9, a, or b', () => {
    const id = uuidv7();
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('is lexicographically time-ordered', () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      ids.push(uuidv7());
    }
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] >= ids[i - 1]).toBe(true);
    }
  });

  it('encodes the current timestamp in the first 12 hex chars', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();

    // Extract 48-bit timestamp from the UUID (first 8 + next 4 hex chars, no dashes)
    const tsHex = id.slice(0, 8) + id.slice(9, 13);
    const tsFromUuid = parseInt(tsHex, 16);

    expect(tsFromUuid).toBeGreaterThanOrEqual(before);
    expect(tsFromUuid).toBeLessThanOrEqual(after + 1); // +1 for rounding
  });

  it('produces unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuidv7()));
    expect(ids.size).toBe(100);
  });
});

describe('isValidUuid', () => {
  it('returns true for a valid lowercase UUID', () => {
    expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('returns false for uppercase UUID', () => {
    expect(isValidUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(false);
  });

  it('returns false for non-string', () => {
    expect(isValidUuid(42)).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
  });

  it('returns false for malformed string', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('')).toBe(false);
  });
});
