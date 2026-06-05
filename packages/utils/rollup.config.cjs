const { withNx } = require('@nx/rollup/with-nx');

module.exports = withNx(
  {
    main: './src/index.ts',
    outputPath: './dist',
    tsConfig: './tsconfig.lib.json',
    compiler: 'swc',
    // Build multiple module formats so the library can be consumed
    // by ESM-aware bundlers, CommonJS consumers, and browsers (UMD).
    format: ['esm', 'cjs', 'umd'],
  },
  {
    // Additional Rollup configuration merged into the generated config.
    // `name` is used for the UMD build as the global variable.
    output: {
      name: 'WinceUtils',
      sourcemap: true,
    },
  },
);
