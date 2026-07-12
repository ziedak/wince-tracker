import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // Target the package.json file specifically
    files: ['package.json'],
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          // Tells Nx which workspace file formats to ignore during the scan
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vite.config.{js,ts,mjs}',
            '{projectRoot}/rollup.config.{js,ts,mjs,mts,cjs,cts}',
          ],
          // Important for non-publishable libs: ensures you don't get warned about missing peerDeps
          //checkPeerDependencies: false,
        },
      ],
    },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
