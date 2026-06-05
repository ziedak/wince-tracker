// Entry point for the browser bundle. Re-export the public API
// from `@wince/core`. Rollup will resolve and inline its dependencies
// (like `@wince/utils`) so the final UMD contains everything.

export * from '@wince/core';


// If you want a minimal runtime (no extra exports), explicitly
// export what you need here instead of star-exporting.
