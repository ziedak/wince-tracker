#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');

const WORKSPACE_ROOT = process.cwd();
const COVERAGE_ROOT = path.join(WORKSPACE_ROOT, 'coverage');
const TEMP_DIR = path.join(COVERAGE_ROOT, '.temp');
const MERGED_DIR = path.join(COVERAGE_ROOT, '.complete');
const REPORTS_DIR = path.join(COVERAGE_ROOT, 'reports');
const DASHBOARD_FILE = path.join(COVERAGE_ROOT, 'index.html');
const SUMMARY_MD_FILE = path.join(COVERAGE_ROOT, 'summary.md');
const SUMMARY_JSON_FILE = path.join(COVERAGE_ROOT, 'summary.json');
const MERGED_COVERAGE_FILE = path.join(MERGED_DIR, 'coverage-complete.json');
const NYC_BIN = require.resolve('nyc/bin/nyc.js');
const COVERAGE_DIR_SUFFIX = path.join('test-output', 'jest', 'coverage');

function resolveDirArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value ? path.resolve(WORKSPACE_ROOT, value) : fallback;
}

function ensureEmptyDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function shouldSkipDir(rootDir, dirPath) {
  const relative = path.relative(rootDir, dirPath);
  if (!relative) return false;

  if (relative === 'coverage' || relative.startsWith(`coverage${path.sep}`)) {
    return true;
  }

  const parts = relative.split(path.sep);
  return parts.some(
    (part) =>
      part === 'node_modules' ||
      part === '.git' ||
      part === '.nx' ||
      part === 'dist' ||
      part === 'out-tsc',
  );
}

function walkWorkspace(rootDir, visitor) {
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    visitor(currentDir);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryPath = path.join(currentDir, entry.name);
      if (!shouldSkipDir(rootDir, entryPath)) {
        stack.push(entryPath);
      }
    }
  }
}

function findCoverageJsonFiles(rootDir) {
  const files = [];

  walkWorkspace(rootDir, (dirPath) => {
    const filePath = path.join(dirPath, 'coverage-final.json');
    if (fs.existsSync(filePath)) {
      files.push(filePath);
    }
  });

  return files;
}

function findHtmlCoverageDirs(rootDir) {
  const dirs = [];

  walkWorkspace(rootDir, (dirPath) => {
    const relative = path.relative(rootDir, dirPath);
    if (!relative) return;

    const suffix = relative.split(path.sep).slice(-3).join(path.sep);
    if (suffix === COVERAGE_DIR_SUFFIX && fs.existsSync(path.join(dirPath, 'index.html'))) {
      dirs.push(dirPath);
    }
  });

  return dirs;
}

function createCoverageKey(rootDir, dirPath) {
  const relative = path.relative(rootDir, dirPath);
  return relative
    .split(path.sep)
    .slice(0, -3)
    .filter(Boolean)
    .join('-') || 'root';
}

function createCoverageDashboard(reports) {
  const rows = reports
    .map(
      (report) => `
        <li>
          <a href="${report.href}">${report.label}</a>
          <span>${report.statsText}</span>
        </li>`,
    )
    .join('');

  fs.writeFileSync(
    DASHBOARD_FILE,
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Coverage reports</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; }
    body { margin: 0; padding: 32px; background: #f6f7fb; color: #1f2937; }
    main { max-width: 960px; margin: 0 auto; }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { margin: 0 0 20px; color: #4b5563; }
    ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
    li { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 18px; display: flex; justify-content: space-between; gap: 16px; }
    a { color: #0f62fe; text-decoration: none; font-weight: 600; }
    span { color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>Coverage reports</h1>
    <p>Collected from package and app test-output folders.</p>
    <ul>${rows}</ul>
  </main>
</body>
</html>
`,
  );
}

function formatCoverageStats(summary) {
  return [
    `Statements ${summary.statements.pct}%`,
    `Branches ${summary.branches.pct}%`,
    `Functions ${summary.functions.pct}%`,
    `Lines ${summary.lines.pct}%`,
  ].join(' · ');
}

function writeCoverageManifest(reports) {
  const manifest = reports.map((report) => ({
    label: report.label,
    source: report.source,
    href: report.href,
    stats: report.stats,
    sourceFiles: report.sourceFiles,
  }));

  fs.writeFileSync(SUMMARY_JSON_FILE, `${JSON.stringify(manifest, null, 2)}\n`);

  const markdown = [
    '# Coverage summary',
    '',
    '| Package | Statements | Branches | Functions | Lines | Files | Report |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...manifest.map((report) => {
      const s = report.stats;
      return `| ${report.label} | ${s.statements.pct}% (${s.statements.covered}/${s.statements.total}) | ${s.branches.pct}% (${s.branches.covered}/${s.branches.total}) | ${s.functions.pct}% (${s.functions.covered}/${s.functions.total}) | ${s.lines.pct}% (${s.lines.covered}/${s.lines.total}) | ${report.sourceFiles.length} | ${report.href} |`;
    }),
    '',
    '## Report details',
    '',
    ...manifest.flatMap((report) => [
      `### ${report.label}`,
      '',
      `- Source: ${report.source}`,
      `- Report: ${report.href}`,
      `- Metrics: ${formatCoverageStats(report.stats)}`,
      report.sourceFiles.length > 0 ? `- Source files:` : `- Source files: none found`,
      ...report.sourceFiles.map((file) => `  - ${file}`),
      '',
    ]),
  ].join('\n');

  fs.writeFileSync(SUMMARY_MD_FILE, `${markdown}\n`);
}

function runNyc(args) {
  const result = spawnSync(process.execPath, [NYC_BIN, ...args], {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    const command = ['node', NYC_BIN, ...args].join(' ');
    throw new Error(`Command failed: ${command}`);
  }
}

function readHtmlCoverageSummary(indexHtmlPath) {
  const html = fs.readFileSync(indexHtmlPath, 'utf8');
  const dom = new JSDOM(html);
  const { document } = dom.window;

  const metricBlocks = [...document.querySelectorAll('.fl.pad1y.space-right2')];
  const summary = {
    statements: { pct: 0, covered: 0, total: 0 },
    branches: { pct: 0, covered: 0, total: 0 },
    functions: { pct: 0, covered: 0, total: 0 },
    lines: { pct: 0, covered: 0, total: 0 },
  };

  for (const block of metricBlocks) {
    const label = block.querySelector('.quiet')?.textContent?.trim().toLowerCase();
    const pctText = block.querySelector('.strong')?.textContent?.trim() ?? '0%';
    const fractionText = block.querySelector('.fraction')?.textContent?.trim() ?? '0/0';
    const [coveredText, totalText] = fractionText.split('/');
    const metric = Number.parseFloat(pctText.replace('%', '')) || 0;
    const covered = Number.parseInt(coveredText ?? '0', 10) || 0;
    const total = Number.parseInt(totalText ?? '0', 10) || 0;

    if (label === 'statements') summary.statements = { pct: metric, covered, total };
    if (label === 'branches') summary.branches = { pct: metric, covered, total };
    if (label === 'functions') summary.functions = { pct: metric, covered, total };
    if (label === 'lines') summary.lines = { pct: metric, covered, total };
  }

  const rows = [...document.querySelectorAll('table.coverage-summary tbody tr')].map((row) => {
    const label = row.querySelector('td.file a')?.textContent?.trim();
    const pctCells = [...row.querySelectorAll('td.pct')].map((cell) => Number.parseFloat(cell.textContent?.trim().replace('%', '') ?? '0') || 0);
    const absCells = [...row.querySelectorAll('td.abs')].map((cell) => cell.textContent?.trim() ?? '0/0');
    const href = row.querySelector('td.file a')?.getAttribute('href') ?? '';

    return {
      label,
      href,
      statements: pctCells[0] ?? 0,
      branches: pctCells[1] ?? 0,
      functions: pctCells[2] ?? 0,
      lines: pctCells[3] ?? 0,
      abs: absCells,
    };
  });

  return { stats: summary, rows };
}

function readCoverageReport(reportDir, rawJsonFileName = 'coverage-final.json') {
  const rawJsonPath = path.join(reportDir, rawJsonFileName);
  const sourceFiles = fs.existsSync(rawJsonPath)
    ? Object.keys(JSON.parse(fs.readFileSync(rawJsonPath, 'utf8'))).map((filePath) => path.relative(WORKSPACE_ROOT, filePath))
    : [];

  const indexHtmlPath = path.join(reportDir, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    const parsed = readHtmlCoverageSummary(indexHtmlPath);
    return {
      stats: parsed.stats,
      statsText: formatCoverageStats(parsed.stats),
      sourceFiles: sourceFiles.length > 0
        ? sourceFiles
        : parsed.rows
            .map((row) => row.label)
            .filter((label) => typeof label === 'string' && label.length > 0),
    };
  }

  return {
    stats: {
      statements: { pct: 0, covered: 0, total: 0 },
      branches: { pct: 0, covered: 0, total: 0 },
      functions: { pct: 0, covered: 0, total: 0 },
      lines: { pct: 0, covered: 0, total: 0 },
    },
    statsText: 'Statements 0% · Branches 0% · Functions 0% · Lines 0%',
    sourceFiles: [],
  };
}

function mergeRawCoverage(scanRoot, coverageFiles, expectedCount) {
  if (coverageFiles.length === 0) return null;

  if (coverageFiles.length !== expectedCount) {
    console.warn(
      `Skipping merged coverage summary: found ${coverageFiles.length} raw coverage files for ${expectedCount} package reports`,
    );
    return null;
  }

  ensureEmptyDir(TEMP_DIR);
  ensureDir(MERGED_DIR);

  for (const filePath of coverageFiles) {
    const relative = path.relative(scanRoot, path.dirname(filePath));
    const prefix = relative.split(path.sep).filter(Boolean).join('-') || 'root';
    const targetPath = path.join(TEMP_DIR, `${prefix}-coverage-final.json`);
    fs.copyFileSync(filePath, targetPath);
    console.log(`Copied ${path.relative(WORKSPACE_ROOT, filePath)} -> ${path.relative(WORKSPACE_ROOT, targetPath)}`);
  }

  runNyc(['merge', TEMP_DIR, MERGED_COVERAGE_FILE]);
  runNyc([
    'report',
    '-t', TEMP_DIR,
    '--report-dir', MERGED_DIR,
    '--reporter=html',
    '--reporter=cobertura',
    '--reporter=lcov',
    '--reporter=text-summary',
  ]);

  console.log(`Merged coverage written to ${path.relative(WORKSPACE_ROOT, MERGED_COVERAGE_FILE)}`);
  return {
    label: 'merged',
    source: 'merged raw coverage',
    href: path.relative(COVERAGE_ROOT, path.join(MERGED_DIR, 'index.html')).replaceAll(path.sep, '/'),
    ...readCoverageReport(MERGED_DIR, 'coverage-complete.json'),
  };
}

function collectHtmlReports(scanRoot) {
  const coverageDirs = findHtmlCoverageDirs(scanRoot);
  if (coverageDirs.length === 0) return [];

  ensureEmptyDir(REPORTS_DIR);

  const reports = [];
  for (const dirPath of coverageDirs) {
    const key = createCoverageKey(scanRoot, dirPath);
    const targetDir = path.join(REPORTS_DIR, key);
    fs.cpSync(dirPath, targetDir, { recursive: true });

    const report = readCoverageReport(targetDir);

    reports.push({
      label: key,
      source: path.relative(WORKSPACE_ROOT, dirPath),
      href: path.relative(COVERAGE_ROOT, path.join(targetDir, 'index.html')).replaceAll(path.sep, '/'),
      ...report,
    });

    console.log(`Copied ${path.relative(WORKSPACE_ROOT, dirPath)} -> ${path.relative(WORKSPACE_ROOT, targetDir)}`);
  }

  return reports;
}

function main() {
  const scanRoot = resolveDirArg('--root', WORKSPACE_ROOT);
  const htmlReports = collectHtmlReports(scanRoot);
  const rawCoverageFiles = findCoverageJsonFiles(scanRoot);
  const mergedReport = mergeRawCoverage(scanRoot, rawCoverageFiles, htmlReports.length);

  const finalReports = mergedReport ? [mergedReport, ...htmlReports] : htmlReports;

  if (finalReports.length === 0) {
    console.warn(`No coverage artifacts found under ${scanRoot}`);
    return;
  }

  createCoverageDashboard(finalReports);
  writeCoverageManifest(finalReports);
  console.log(`Coverage dashboard written to ${path.relative(WORKSPACE_ROOT, DASHBOARD_FILE)}`);
}

main();
