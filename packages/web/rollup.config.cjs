const path = require('path');
const alias = require('@rollup/plugin-alias');
const fs = require('fs');
const resolve = require('@rollup/plugin-node-resolve').nodeResolve;
const commonjs = require('@rollup/plugin-commonjs');
const _esbuildPkg = require('rollup-plugin-esbuild');
const esbuild = _esbuildPkg && _esbuildPkg.default ? _esbuildPkg.default : _esbuildPkg;
const { terser } = require('rollup-plugin-terser');

module.exports = {
  input: 'src/index.ts',
  output: [
    { file: 'dist/index.esm.js', format: 'es', sourcemap: true },
    { file: 'dist/index.cjs.js', format: 'cjs', sourcemap: true },
    { file: 'dist/index.umd.js', format: 'umd', name: 'Wince', sourcemap: true },
    // Also write the UMD bundle directly into the sandbox vendor folder
    { file: path.resolve(__dirname, '..', '..', 'sandbox', 'vendor', 'index.umd.js'), format: 'umd', name: 'Wince', sourcemap: true }
  ],
  // Important: do not treat workspace libraries as external so Rollup
  // will inline `@wince/core` and its dependencies into the single bundle.
  external: [],
  plugins: [
    // Auto-generate alias entries for all workspace packages under /packages
    // so Rollup resolves `@wince/x` to `packages/x/src/index.ts`.
    (() => {
      const pkgsDir = path.resolve(__dirname, '..', '..', 'packages');
      const entries = [];
      if (fs.existsSync(pkgsDir)) {
        for (const name of fs.readdirSync(pkgsDir)) {
          const pkgDir = path.join(pkgsDir, name);
          try {
            if (!fs.statSync(pkgDir).isDirectory()) continue;
          } catch (e) {
            continue;
          }
          const srcIndex = path.join(pkgDir, 'src', 'index.ts');
          if (fs.existsSync(srcIndex)) {
            entries.push({ find: `@wince/${name}`, replacement: srcIndex });
          }
        }
      }
      return alias({ entries });
    })(),
    // Ensure .ts files are resolved when importing from the aliased sources
    resolve({ extensions: ['.ts', '.tsx', '.mjs', '.js', '.json'], browser: true, preferBuiltins: false }),
    // Use esbuild to transpile TypeScript (works for files outside this tsconfig)
    esbuild({
      include: /\.([jt]s|tsx?)$/,
      sourceMap: true,
      target: 'es2020',
      tsconfig: path.resolve(__dirname, 'tsconfig.lib.json')
    }),
    // Convert any CommonJS dependencies to ES modules after TS compilation
    commonjs(),
    terser()
  ],
  treeshake: true
};
