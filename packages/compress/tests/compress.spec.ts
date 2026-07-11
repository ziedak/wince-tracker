import {
  compressAsync,
  decompressAsync,
  gzipCompressSync,
  gzipDecompressSync
} from '../src/compress.js';
describe('compressAsync', () => {
  it('compresses a string to a Uint8Array', async () => {
    const out = await compressAsync('hello world');
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
      configurable: true
    });

    try {
      const out = await compressAsync('native-fallback');
      expect(new TextDecoder().decode(gzipDecompressSync(out))).toBe('native-fallback');
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      Object.defineProperty(globalThis, 'CompressionStream', {
        value: originalCompressionStream,
        configurable: true
      });
    }
  });
});
describe('decompressAsync', () => {
  it('decompresses a Uint8Array to the original string', async () => {
    const original = 'hello world';
    const compressed = gzipCompressSync(original);
    const decompressed = await decompressAsync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(original);
  });

  it('falls back when native decompression is present but fails', async () => {
    const originalDecompressionStream = (globalThis as Record<string, unknown>).DecompressionStream;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    class ThrowingDecompressionStream {
      constructor() {
        throw new Error('boom');
      }
    }

    Object.defineProperty(globalThis, 'DecompressionStream', {
      value: ThrowingDecompressionStream,
      configurable: true
    });

    try {
      const original = 'native-fallback-decompress';
      const compressed = gzipCompressSync(original);
      const decompressed = await decompressAsync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe(original);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      Object.defineProperty(globalThis, 'DecompressionStream', {
        value: originalDecompressionStream,
        configurable: true
      });
    }
  });
});

describe('gzipCompressSync', () => {
  it('returns a Uint8Array', () => {
    const out = gzipCompressSync('hello world');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(0);
  });

  it('accepts a string', () => {
    const out = gzipCompressSync('hello world');
    expect(out[0]).toBe(0x1f); // gzip magic byte
    expect(out[1]).toBe(0x8b);
  });

  it('accepts a Uint8Array', () => {
    const input = new TextEncoder().encode('hello');
    const out = gzipCompressSync(input);
    expect(out).toBeInstanceOf(Uint8Array);
  });

  it('accepts an ArrayBuffer', () => {
    const input = new TextEncoder().encode('buffer input').buffer as ArrayBuffer;
    const out = gzipCompressSync(input);
    expect(new TextDecoder().decode(gzipDecompressSync(out))).toBe('buffer input');
  });

  it('accepts a typed array view', () => {
    const bytes = new TextEncoder().encode('view input');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = gzipCompressSync(view as unknown as ArrayBuffer);
    expect(new TextDecoder().decode(gzipDecompressSync(out))).toBe('view input');
  });

  it('rejects unsupported input types', () => {
    expect(() => gzipCompressSync({} as ArrayBuffer)).toThrow(TypeError);
  });

  it('round-trips with gzipDecompressSync', () => {
    const original = 'round-trip test payload 🛒';
    const compressed = gzipCompressSync(original);
    const decompressed = gzipDecompressSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(original);
  });
});

describe('gzipDecompressSync', () => {
  it('decompresses output from gzipCompressSync', () => {
    const payload = 'cart_abandon event payload';
    const compressed = gzipCompressSync(payload);
    const decompressed = gzipDecompressSync(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(payload);
  });

  it('round-trips large payloads', () => {
    const large = JSON.stringify(
      Array.from({ length: 500 }, (_, i) => ({
        eid: `event-${i}`,
        t: 'add_to_cart',
        ts: Date.now()
      }))
    );
    const out = gzipDecompressSync(gzipCompressSync(large));
    expect(new TextDecoder().decode(out)).toBe(large);
  });
});
