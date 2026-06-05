# @wince/web — Build & verification

Quick reference for producing the canonical bundles, generating the mangled-name map, running analysis, and enforcing gzipped size budgets.

**Prerequisites**
- Install Bun (used for scripts in this workspace).

**Key scripts**
- `generate-mangled` — generate `src/mangled-names.generated.ts` from `mangled-whitelist.json`.
- `build` — runs `prebuild` (generates mapping) then Rollup to output `dist/*` bundles.
- `build:analyze` — build with `ANALYZE=true` to produce visualizer HTML.
- `size` — runs a gzipped-size checker against `dist/*` artifacts.
- `test-gzip` — demo script to validate the runtime gzip helper.

Commands (from repo root)

```bash
# generate mapping (and inspect before committing)
bun --cwd packages/web run generate-mangled

# commit the generated mapping (recommended lockfile)
git add packages/web/src/mangled-names.generated.ts
git commit -m "chore(web): update mangled-name mapping"

# build (runs prebuild which regenerates mapping)
bun --cwd packages/web run build

# build with analyzer (produces dist/visualizer*.html)
ANALYZE=true bun --cwd packages/web run build
# or
bun --cwd packages/web run build:analyze

# run gzipped size check (fails non-zero if budgets exceeded)
bun --cwd packages/web run size

# quick gzip helper demo
bun --cwd packages/web run test-gzip
```

Files of interest
- `mangled-whitelist.json` — add any public keys you want mapped here.
- `scripts/write-mangled-property-names.mjs` — deterministic mapping generator.
- `src/mangled-names.generated.ts` — generated lockfile (should be committed).
- `src/gzip.ts` — CompressionStream + `fflate` fallback helper used for runtime gzip.
- `rollup.config.cjs` — Rollup config (produces `./lite` output and full bundle).
- `.github/workflows/bundle-check.yml` — CI job that regenerates mapping, builds, and runs the `size` check.

Policy & workflow notes
- We commit `src/mangled-names.generated.ts` to keep builds deterministic. CI re-generates and fails the job if the generated file would differ.
- For mapping updates: update `mangled-whitelist.json`, run `bun --cwd packages/web run generate-mangled`, run `bun --cwd packages/web run check-mangled`, review changes, and commit with a short rationale.
- Initial gzipped budgets: `lite` = 20 KiB, `full` = 40 KiB. Tweak budgets in `scripts/check-size.mjs` as needs evolve.

Troubleshooting
- If `fflate` fails to resolve in your environment, run `bun add fflate` at the repo root or re-run `bun install`.

Questions or changes to the workflow? Open a PR describing the mapping changes and the expected size deltas.
