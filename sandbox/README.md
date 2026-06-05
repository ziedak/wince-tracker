# Sandbox — Wince UMD

Open `sandbox/index.html` to load the UMD bundles built for this workspace.

Recommended (serve from repo root):

Using Python built-in server:

```bash
# from repository root
python3 -m http.server 8000
# then open http://localhost:8000/sandbox/index.html
```

Using `http-server` (npm):

```bash
# from repository root
npx http-server -p 8000
# then open http://localhost:8000/sandbox/index.html
```

Notes:
- The sandbox expects the built files to exist at `packages/*/dist/*.umd.js`.
- If you rebuild packages, refresh the page.
