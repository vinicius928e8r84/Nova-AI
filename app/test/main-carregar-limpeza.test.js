'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const AJUDA = path.join(__dirname, 'ajuda', 'carregar-main.js');

test('carregarMain apaga a pasta temporaria ao fim do processo', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-limpeza-'));
  try {
    const criada = execFileSync(process.execPath, ['-e', `const { carregarMain } = require(${JSON.stringify(AJUDA)}); process.stdout.write(carregarMain().raiz)`], {
      env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
      encoding: 'utf8',
    });
    assert.ok(criada.startsWith(tmp), criada);
    assert.deepStrictEqual(fs.readdirSync(tmp), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
