const { withNx } = require('@nx/rollup/with-nx');

module.exports = withNx(
  {
   main: './src/index.ts',
    outputPath: './dist',
    tsConfig: './tsconfig.lib.json',
    compiler: 'swc',
    format: ['esm'],
  },
  {
    // Additional Rollup configuration merged into the generated config.
    // `name` is used for the UMD build as the global variable.

  },
);
