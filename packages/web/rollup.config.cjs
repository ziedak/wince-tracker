const path = require('path');
const alias = require('@rollup/plugin-alias');
const fs = require('fs');
const resolve = require('@rollup/plugin-node-resolve').nodeResolve;
const commonjs = require('@rollup/plugin-commonjs');
const _esbuildPkg = require('rollup-plugin-esbuild');
const esbuild = _esbuildPkg && _esbuildPkg.default ? _esbuildPkg.default : _esbuildPkg;
const _terserPkg = require('@rollup/plugin-terser');
const terser = _terserPkg && _terserPkg.default ? _terserPkg.default : _terserPkg;

let visualizer;
try {
  const _visualizerPkg = require('rollup-plugin-visualizer');
  visualizer =
    _visualizerPkg && _visualizerPkg.visualizer ? _visualizerPkg.visualizer : _visualizerPkg;
} catch (e) {
  console.warn(
    `rollup-plugin-visualizer not found, bundle analysis will be unavailable. To enable, install it as a dev dependency. error: ${e.message}`
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
        console.warn(`Unable to access package directory ${pkgDir}: ${e.message}`);
        continue;
      }
      const srcIndex = path.join(pkgDir, 'src', 'index.ts');
      if (fs.existsSync(srcIndex)) {
        // Register sub-path aliases declared in the package's exports field.
        // Only files that exist in src/ AND are named in exports are wired up,
        // so internal files (utils.ts, DurableQueue.ts, etc.) are not exposed.
        try {
          const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
          const exportKeys = Object.keys(pkgJson.exports ?? {});
          for (const key of exportKeys) {
            if (key === '.' || key === './package.json') continue;
            const subName = key.replace(/^\.\//, '');
            const srcFile = path.join(pkgDir, 'src', `${subName}.ts`);
            if (fs.existsSync(srcFile)) {
              entries.push({ find: `@wince/${name}/${subName}`, replacement: srcFile });
            }
          }
        } catch {
          /* ignore — package.json not readable */
        }
        entries.push({ find: `@wince/${name}`, replacement: srcIndex });
      }
    }
  }
  return alias({ entries });
})();

const { version: pkgVersion } = require('./package.json');
const BANNER = `/*! @wince/web v${pkgVersion} | MIT */`;

const basePluginsNoTerser = [
  aliasPlugin,
  // Resolve node_modules; also honour the @wince/source export condition
  // as a secondary path (alias plugin above wins for @wince/* packages).
  resolve({
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.json'],
    browser: true,
    preferBuiltins: false,
    exportConditions: ['@wince/source', 'module', 'browser', 'import', 'default']
  }),
  // Convert CJS deps to ESM before esbuild transpiles them
  commonjs(),
  // Use esbuild to transpile TypeScript (works for files outside this tsconfig)
  esbuild({
    include: /\.([jt]s|tsx?)$/,
    sourceMap: true,
    target: 'es2020',
    tsconfig: path.resolve(__dirname, 'tsconfig.lib.json')
  })
];

const terserDefault = terser({
  compress: { ecma: 2020, passes: 2 },
  format: { ecma: 2020 }
});

const terserLite = terser({
  compress: { ecma: 2020, passes: 3 },
  format: { ecma: 2020 },
  mangle: {
    properties: {
      // only mangle internal names starting with underscore
      regex: /^_/,
      keep_quoted: true
    }
  }
});

const basePlugins = [...basePluginsNoTerser, terserDefault];
const litePlugins = [...basePluginsNoTerser, terserLite];

if (process.env.ANALYZE && visualizer) {
  basePlugins.push(
    visualizer({
      filename: 'dist/visualizer.html',
      title: 'Wince web bundle',
      gzipSize: true
    })
  );
  litePlugins.push(
    visualizer({
      filename: 'dist/visualizer-lite.html',
      title: 'Wince web bundle (lite)',
      gzipSize: true
    })
  );
}

const baseConfig = {
  input: 'src/index.ts',
  output: [
    { file: 'dist/index.esm.js', format: 'es', sourcemap: true, banner: BANNER },
    { file: 'dist/index.cjs.js', format: 'cjs', sourcemap: true, banner: BANNER },
    {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'Wince',
      sourcemap: true,
      banner: BANNER
    },
    // Also write the UMD bundle directly into the sandbox vendor folder
    {
      file: path.resolve(__dirname, '..', '..', 'sandbox', 'vendor', 'index.umd.js'),
      format: 'umd',
      name: 'Wince',
      sourcemap: true,
      banner: BANNER
    },
    {
      file: path.resolve(__dirname, '..', '..', 'dist', 'packages', 'web', 'index.umd.js'),
      format: 'umd',
      name: 'Wince',
      sourcemap: true,
      banner: BANNER
    }
  ],
  // Important: do not treat workspace libraries as external so Rollup
  // will inline `@wince/core` and its dependencies into the single bundle.
  external: [],
  plugins: basePlugins,
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false
  }
};

const liteConfig = {
  input: 'src/index.lite.ts',
  output: [
    { file: 'dist/index.lite.esm.js', format: 'es', sourcemap: true, banner: BANNER },
    { file: 'dist/index.lite.cjs.js', format: 'cjs', sourcemap: true, banner: BANNER },
    {
      file: 'dist/index.lite.umd.js',
      format: 'umd',
      name: 'WinceLite',
      sourcemap: true,
      banner: BANNER
    },
    // Also write the lite UMD bundle into sandbox vendor for testing
    {
      file: path.resolve(__dirname, '..', '..', 'sandbox', 'vendor', 'index.lite.umd.js'),
      format: 'umd',
      name: 'WinceLite',
      sourcemap: true,
      banner: BANNER
    },
    {
      file: path.resolve(__dirname, '..', '..', 'dist', 'packages', 'web', 'index.lite.umd.js'),
      format: 'umd',
      name: 'WinceLite',
      sourcemap: true,
      banner: BANNER
    }
  ],
  external: [],
  plugins: litePlugins,
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false
  }
};

const workerConfig = {
  input: 'src/worker/tracker.worker.ts',
  output: [
    {
      file: 'dist/tracker.worker.js',
      format: 'iife',
      name: '_WinceWorker', // IIFE wrapper name (not exported)
      sourcemap: true,
      banner: BANNER
    }
  ],
  external: [],
  plugins: [...basePluginsNoTerser, terserDefault],
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    unknownGlobalSideEffects: false
  }
};

module.exports = [baseConfig, liteConfig, workerConfig];
