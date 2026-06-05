const path = require('path');
const alias = require('@rollup/plugin-alias');
const fs = require('fs');
const resolve = require('@rollup/plugin-node-resolve').nodeResolve;
const commonjs = require('@rollup/plugin-commonjs');
const _esbuildPkg = require('rollup-plugin-esbuild');
const esbuild =
  _esbuildPkg && _esbuildPkg.default ? _esbuildPkg.default : _esbuildPkg;
const { terser } = require('rollup-plugin-terser');

let visualizer;
try {
  const _visualizerPkg = require('rollup-plugin-visualizer');
  visualizer =
    _visualizerPkg && _visualizerPkg.visualizer
      ? _visualizerPkg.visualizer
      : _visualizerPkg;
} catch (e) {
  console.warn(
    `rollup-plugin-visualizer not found, bundle analysis will be unavailable. To enable, install it as a dev dependency. error: ${e.message}`,
  );
  visualizer = null;
}

// Auto-generate alias entries for all workspace packages under /packages
// so Rollup resolves `@wince/x` to `packages/x/src/index.ts`.
const aliasPlugin = (() => {
  const pkgsDir = path.resolve(__dirname, '..', '..', 'packages');
  const entries = [];
  if (fs.existsSync(pkgsDir)) {
    for (const name of fs.readdirSync(pkgsDir)) {
      const pkgDir = path.join(pkgsDir, name);
      try {
        if (!fs.statSync(pkgDir).isDirectory()) continue;
      } catch (e) {
        console.warn(
          `Unable to access package directory ${pkgDir}: ${e.message}`,
        );
        continue;
      }
      const srcIndex = path.join(pkgDir, 'src', 'index.ts');
      if (fs.existsSync(srcIndex)) {
        entries.push({ find: `@wince/${name}`, replacement: srcIndex });
      }
    }
  }
  return alias({ entries });
})();

const basePluginsNoTerser = [
  aliasPlugin,
  // Ensure .ts files are resolved when importing from the aliased sources
  resolve({
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.json'],
    browser: true,
    preferBuiltins: false,
  }),
  // Use esbuild to transpile TypeScript (works for files outside this tsconfig)
  esbuild({
    include: /\.([jt]s|tsx?)$/,
    sourceMap: true,
    target: 'es2020',
    tsconfig: path.resolve(__dirname, 'tsconfig.lib.json'),
  }),
  // Convert any CommonJS dependencies to ES modules after TS compilation
  commonjs(),
];

const terserDefault = terser();
const terserLite = terser({
  compress: { passes: 2 },
  mangle: {
    properties: {
      // only mangle internal names starting with underscore
      regex: /^_/,
      keep_quoted: true,
    },
  },
});

const basePlugins = [...basePluginsNoTerser, terserDefault];
const litePlugins = [...basePluginsNoTerser, terserLite];

if (process.env.ANALYZE && visualizer) {
  basePlugins.push(
    visualizer({
      filename: 'dist/visualizer.html',
      title: 'Wince web bundle',
      gzipSize: true,
    }),
  );
  litePlugins.push(
    visualizer({
      filename: 'dist/visualizer-lite.html',
      title: 'Wince web bundle (lite)',
      gzipSize: true,
    }),
  );
}

const baseConfig = {
  input: 'src/index.ts',
  output: [
    { file: 'dist/index.esm.js', format: 'es', sourcemap: true },
    { file: 'dist/index.cjs.js', format: 'cjs', sourcemap: true },
    {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'Wince',
      sourcemap: true,
    },
    // Also write the UMD bundle directly into the sandbox vendor folder
    {
      file: path.resolve(
        __dirname,
        '..',
        '..',
        'sandbox',
        'vendor',
        'index.umd.js',
      ),
      format: 'umd',
      name: 'Wince',
      sourcemap: true,
    },
  ],
  // Important: do not treat workspace libraries as external so Rollup
  // will inline `@wince/core` and its dependencies into the single bundle.
  external: [],
  plugins: basePlugins,
  treeshake: true,
};

const liteConfig = {
  input: 'src/index.lite.ts',
  output: [
    { file: 'dist/index.lite.esm.js', format: 'es', sourcemap: true },
    { file: 'dist/index.lite.cjs.js', format: 'cjs', sourcemap: true },
    {
      file: 'dist/index.lite.umd.js',
      format: 'umd',
      name: 'WinceLite',
      sourcemap: true,
    },
    // Also write the lite UMD bundle into sandbox vendor for testing
    {
      file: path.resolve(
        __dirname,
        '..',
        '..',
        'sandbox',
        'vendor',
        'index.lite.umd.js',
      ),
      format: 'umd',
      name: 'WinceLite',
      sourcemap: true,
    },
  ],
  external: [],
  plugins: litePlugins,
  treeshake: true,
};

module.exports = [baseConfig, liteConfig];
