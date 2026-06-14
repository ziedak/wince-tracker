import { compress, compressSync, decompressSync } from './compress';

describe('compress', () => {
  it('compresses a string to a Uint8Array', async () => {
    const out = await compress('hello world');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(0);
  });

  it('falls back when native compression is present but fails', async () => {
    const originalCompressionStream = (globalThis as Record<string, unknown>).CompressionStream;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    class ThrowingCompressionStream {
      constructor() {
        throw new Error('boom');
      }
    }

    Object.defineProperty(globalThis, 'CompressionStream', {
      value: ThrowingCompressionStream,
      configurable: true,
    });

    try {
      const out = await compress('native-fallback');
      expect(new TextDecoder().decode(decompressSync(out))).toBe('native-fallback');
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      Object.defineProperty(globalThis, 'CompressionStream', {
        value: originalCompressionStream,
        configurable: true,
      });
    }
  });
});

describe('compressSync', () => {
  it('returns a Uint8Array', () => {
    const out = compressSync('hello world');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(0);
  });

  it('accepts a string', () => {
    const out = compressSync('hello world');
    expect(out[0]).toBe(0x1f); // gzip magic byte
    expect(out[1]).toBe(0x8b);
  });

  it('accepts a Uint8Array', () => {
    const input = new TextEncoder().encode('hello');
    const out = compressSync(input);
    expect(out).toBeInstanceOf(Uint8Array);
  });

  it('accepts an ArrayBuffer', () => {
    const input = new TextEncoder().encode('buffer input').buffer as ArrayBuffer;
    const out = compressSync(input);
    expect(new TextDecoder().decode(decompressSync(out))).toBe('buffer input');
  });

  it('accepts a typed array view', () => {
    const bytes = new TextEncoder().encode('view input');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = compressSync(view as unknown as ArrayBuffer);
    expect(new TextDecoder().decode(decompressSync(out))).toBe('view input');
  });

  it('rejects unsupported input types', () => {
    expect(() => compressSync({} as ArrayBuffer)).toThrow(TypeError);
  });

  it('round-trips with decompressSync', () => {
    const original = 'round-trip test payload 🛒';
    const compressed   = compressSync(original);
    const decompressed = decompressSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(original);
  });
});

describe('decompressSync', () => {
  it('decompresses output from compressSync', () => {
    const payload = 'cart_abandon event payload';
    const compressed   = compressSync(payload);
    const decompressed = decompressSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(payload);
  });

  it('round-trips large payloads', () => {
    const large = JSON.stringify(Array.from({ length: 500 }, (_, i) => ({
      eid: `event-${i}`, t: 'add_to_cart', ts: Date.now(),
    })));
    const out = decompressSync(compressSync(large));
    expect(new TextDecoder().decode(out)).toBe(large);
  });
});
