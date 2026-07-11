export type compressAsync = (input: Uint8Array | ArrayBuffer | string) => Promise<Uint8Array>;
export type decompressAsync = (input: Uint8Array | ArrayBuffer) => Promise<Uint8Array>;
export type gzipCompressSync = (input: Uint8Array | ArrayBuffer | string) => Uint8Array;
export type gzipDecompressSync = (input: Uint8Array | ArrayBuffer) => Uint8Array;
