'use strict';

/**
 * Test runner: seeds a throwaway database and runs the API suite, then the
 * browser suite when a Chrome binary is available.
 *
 *   npm test
 *   CHROME=/path/to/chrome npm test     # includes the browser suite
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');

/** Each suite gets its own throwaway database so counts don't leak between them. */
const dbFiles = [];
function freshDb(suite) {
  const file = path.join(os.tmpdir(), `nextbuy-test-${suite}-${Date.now()}.db`);
  dbFiles.push(file);
  return file;
}
function cleanup() {
  for (const f of dbFiles) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(f + suffix); } catch { /* not there */ }
    }
  }
}
process.on('exit', cleanup);

function seedDb(file) {
  const res = spawnSync('node', ['db/seed.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, DB_PATH: file } });
  if (res.status !== 0) { console.error('Seeding failed for ' + file); process.exit(1); }
}

function run(label, script, env) {
  console.log(`\n──────── ${label} ────────`);
  const res = spawnSync('node', [script], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return res.status === 0;
}

const apiDb = freshDb('api');
seedDb(apiDb);
let ok = run('API tests', path.join('test', 'api-test.js'), { PORT: '3311', DB_PATH: apiDb });

// Browser tests need puppeteer-core + a Chrome binary.
let hasPuppeteer = false;
try { require.resolve('puppeteer-core', { paths: [root] }); hasPuppeteer = true; } catch { /* not installed */ }

if (hasPuppeteer && process.env.CHROME) {
  const browserDb = freshDb('browser');
  seedDb(browserDb);
  const browserOk = run('Browser tests', path.join('test', 'browser-test.js'), { PORT: '3322', DB_PATH: browserDb });
  ok = ok && browserOk;
} else {
  console.log('\n──────── Browser tests skipped ────────');
  console.log(hasPuppeteer ? '  Set CHROME=/path/to/chrome to run them.' : '  Install puppeteer-core and set CHROME to run them.');
}

console.log(ok ? '\nAll test suites passed.' : '\nSome tests failed.');
process.exit(ok ? 0 : 1);
