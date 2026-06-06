// Minimal entrypoint for a lighter runtime.
// Import only the internal core implementation to avoid top-level
// side-effects that may exist in `@wince/core`'s public entry.
export { core } from '@wince/core';
