#!/usr/bin/env node
/*
  Sandbox tester

  - Starts a lightweight static server serving `sandbox/`
  - Launches Puppeteer headless
  - Runs a core-only smoke test (no plugins)
  - Enables plugins one-by-one and simulates interactions
  - Captures outgoing POST requests and prints a short report

  Usage: node tools/sandbox-tester/runner.js
*/

const http = require('http');
const fs = require('fs');
const path = require('path');

async function startStaticServer(rootDir, port = 8000) {
  const mime = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.map': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
  };

  const server = http.createServer(async (req, res) => {
    try {
      const reqPath = decodeURIComponent(req.url.split('?')[0]);
      let filePath = path.join(rootDir, reqPath);
      if (reqPath === '/' || reqPath === '') filePath = path.join(rootDir, 'index.html');
      if (!filePath.startsWith(rootDir)) {
        res.statusCode = 403;
        return res.end('Forbidden');
      }
      if (!fs.existsSync(filePath)) {
        res.statusCode = 404;
        return res.end('Not found');
      }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        const idx = path.join(filePath, 'index.html');
        if (fs.existsSync(idx)) filePath = idx;
        else {
          res.statusCode = 404;
          return res.end('Not found');
        }
      }
      const ext = path.extname(filePath).toLowerCase();
      const ct = mime[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', ct + '; charset=utf-8');
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', (err) => {
      if (err) return reject(err);
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  const ROOT = path.join(__dirname, '..', '..');
  const SANDBOX = path.join(ROOT, 'sandbox');
  const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;

  if (!fs.existsSync(SANDBOX)) {
    console.error('sandbox/ directory not found at', SANDBOX);
    process.exit(1);
  }

  console.log('Starting static server for sandbox at port', PORT);
  const { server, url } = await startStaticServer(SANDBOX, PORT);

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (err) {
    console.error('puppeteer not installed. Run `npm i -D puppeteer` at repo root.');
    server.close();
    process.exit(1);
  }

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  const plugins = [
    'mountClick',
    'mountPageView',
    'mountFormInteraction',
    'mountFormAbandon',
    'mountErrorCapture',
    'mountCopyPaste',
    'mountRageClick',
    'mountDeadClick',
    'mountCart',
  ];

  const results = [];

  async function runScenario(name, enabledPlugins, interactionFn) {
    const page = await browser.newPage();
    const captured = [];

    page.on('request', (req) => {
      try {
        if (req.method && req.method().toUpperCase() === 'POST') {
          captured.push({ url: req.url(), postData: req.postData && req.postData() });
        }
      } catch (e) { }
    });

    await page.evaluateOnNewDocument((enabled) => {
      const ENABLED = Array.isArray(enabled) ? enabled : [];
      const enabledSet = new Set(ENABLED);

      // Intercept window.Wince to stub mount functions we don't want
      Object.defineProperty(window, 'Wince', {
        configurable: true,
        set(v) {
          try {
            const orig = v;
            const keys = Object.keys(orig || {});
            for (const k of keys) {
              if (k.startsWith('mount')) {
                if (!enabledSet.has(k)) {
                  orig[k] = function () { return function () {}; };
                }
              }
            }
            Object.defineProperty(window, 'Wince', { value: orig, configurable: true, writable: true });
          } catch (err) {
            // ignore
          }
        }
      });

      // Intercept navigator.sendBeacon to capture beacon payloads and forward via fetch
      try {
        window.__beaconPayloads = [];
        const origSend = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function(url, data) {
          try {
            if (typeof data === 'string') {
              window.__beaconPayloads.push({ url, body: data });
            } else {
              window.__beaconPayloads.push({ url, body: null });
              if (data && typeof data.arrayBuffer === 'function') {
                data.arrayBuffer().then(buf => {
                  try {
                    const text = new TextDecoder().decode(new Uint8Array(buf));
                    window.__beaconPayloads.push({ url, body: text });
                  } catch (e) { /* ignore */ }
                });
              }
            }
            try { fetch(url, { method: 'POST', body: data, keepalive: true }); } catch (e) { /* ignore */ }
          } catch (e) { /* ignore */ }
          return true;
        };
      } catch (e) {
        // ignore if navigator.sendBeacon is not writable
      }
    }, enabledPlugins);

    const target = `${url}/index.html`;
    console.log(`→ [${name}] loading ${target} (enabled: ${enabledPlugins.join(',') || 'none'})`);
    try {
      await page.goto(target, { waitUntil: 'networkidle2', timeout: 20000 });
    } catch (e) {
      // ignore navigation timeout — page may still be usable
    }

    try {
      await page.waitForFunction(() => {
        const log = document.getElementById('log');
        return !!(log && log.textContent && log.textContent.indexOf('SDK initialised') !== -1);
      }, { timeout: 5000 });
    } catch (e) {
      // continue anyway
    }

    if (typeof interactionFn === 'function') {
      try {
        await interactionFn(page);
      } catch (err) {
        console.error(`[${name}] interaction error:`, err && err.message ? err.message : err);
      }
    }

    await delay(2500);

    // collect any intercepted beacon payloads (set by evaluateOnNewDocument)
    let beacons = [];
    try {
      beacons = await page.evaluate(() => window.__beaconPayloads || []);
    } catch (e) {
      // ignore
    }

    await page.close();

    results.push({ name, captured, beacons });
    console.log(`← [${name}] captured ${captured.length} POST request(s) and ${beacons.length} beacon(s)`);
  }

  await runScenario('core-only', [], null);

  for (const p of plugins) {
    const fnMap = {
      mountClick: async (page) => { await page.click('#test-btn'); },
      mountRageClick: async (page) => { await page.evaluate(() => { const b = document.getElementById('test-btn'); for (let i=0;i<3;i++) b.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); },
      mountDeadClick: async (page) => { await page.click('#test-btn'); },
      mountCopyPaste: async (page) => { await page.evaluate(() => { const p = document.getElementById('test-p'); if (!p) return; const r = document.createRange(); r.selectNodeContents(p); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand && document.execCommand('copy'); }); },
      mountErrorCapture: async (page) => { await page.evaluate(() => setTimeout(() => { throw new Error('puppeteer-test-error'); }, 0)); },
      mountFormInteraction: async (page) => { await page.focus('#test-form input[name="email"]'); await page.keyboard.type('test@example.com'); await page.focus('#test-btn'); },
      mountFormAbandon: async (page) => {
        await page.type('#test-form input[name="email"]', 'test@example.com');
        // Ensure input event bubbles to the form listener and let it process
        await page.evaluate(() => {
          const el = document.querySelector('#test-form input[name="email"]');
          if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await delay(120);
        // Trigger pagehide to invoke before-drain hooks and emit $form_abandon
        await page.evaluate(() => {
          try { window.dispatchEvent(new Event('pagehide')); } catch (e) { /* ignore */ }
        });
      },
      mountPageView: async (page) => { /* mountPageView fires on mount */ },
      mountCart: async (page) => { await page.evaluate(() => {
          document.dispatchEvent(new CustomEvent('wince:cart', { detail: { action: 'add', product_id: 'SKU-123', price: 9.99, quantity: 1 } }));
        }); },
    };

    const inter = fnMap[p];
    await runScenario(p, [p], inter);
  }

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`- ${r.name}: ${r.captured.length} POST(s)`);
    if (r.captured.length > 0) {
      try {
        const preview = r.captured[0].postData;
        const text = preview && preview.slice ? preview.slice(0, 400) : String(preview);
        console.log('  body preview:', text);
        try {
          const obj = JSON.parse(r.captured[0].postData);
          if (Array.isArray(obj.events)) {
            const types = obj.events.map((e) => e.t || e.event || '<unknown>');
            console.log('  events in first POST:', types.join(', '));
            if (process.env.VERBOSE_EVENTS) {
              try {
                console.log('  parsed events:', JSON.stringify(obj.events, null, 2));
              } catch (e) {
                console.log('  parsed events: <unserializable>');
              }
            }
          }
        } catch (e) {
          // not JSON — ignore
        }
      } catch (e) {}
    }
    if (r.beacons && r.beacons.length > 0) {
      console.log(`  beacon(s): ${r.beacons.length}`);
      for (let i = 0; i < r.beacons.length; i++) {
        const b = r.beacons[i];
        try {
          const bodyPreview = b && b.body ? (typeof b.body === 'string' ? b.body.slice(0, 400) : String(b.body)) : '<non-serializable>';
          console.log(`  beacon[${i}] -> ${b.url} body preview:`, bodyPreview);
          if (b && b.body) {
            try {
              const obj = JSON.parse(b.body);
              if (Array.isArray(obj.events)) {
                const types = obj.events.map((e) => e.t || e.event || '<unknown>');
                console.log(`    events in beacon[${i}]:`, types.join(', '));
              }
            } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }
      }
    }
  }

  await browser.close();
  server.close();
}

run().catch((err) => {
  console.error('Error running sandbox tester:', err && err.stack ? err.stack : err);
  process.exit(1);
});
