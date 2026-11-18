const { execFileSync } = require('child_process');
const path = require('path');

const raiz = path.join(__dirname, '..');
const cli = path.join(raiz, 'node_modules', 'playwright', 'cli.js');

execFileSync(process.execPath, [cli, 'install', 'chromium'], {
  cwd: raiz,
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(raiz, 'browsers') },
});
