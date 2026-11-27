'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { casa, casaAlgum, extensaoDe } = require('../globs');

const CAMINHOS = [
  'a.js', 'app/x.js', 'app/dist/assets/i.js', 'app/dist/x.js', 'interface/dist/a', 'interface/p/q/dist/a', 'interface/p/dist', 'b.map', 'x/b.map',
  'a', 'a/b', 'a/c/b', 'a/x/y/b', 'ab', '1.txt', '12.txt', 'd/1.txt', 'f.mjs', 'f.ts', 'src/a1.py', 'src/d1.py', 'dir/x', 'q/dir/x',
  'dir', 'x+y(1)|$^.js', 'a.b/z', 'c/z', 'axb/z', 'interface/q/index-Dun7lr2S.patched.js', 'marked.min.js', 'vendor/marked.min.js', 'markedxmin.js',
];

const JS = ['a.js', 'app/x.js', 'app/dist/assets/i.js', 'app/dist/x.js', 'x+y(1)|$^.js', 'interface/q/index-Dun7lr2S.patched.js', 'marked.min.js', 'vendor/marked.min.js', 'markedxmin.js'];

const CASAM = {
  '**/*.js': JS,
  'app/dist/assets/': ['app/dist/assets/i.js'],
  'interface/**/dist/': ['interface/dist/a', 'interface/p/q/dist/a'],
  '*.map': ['b.map', 'x/b.map'],
  '**': CAMINHOS,
  'a/**': ['a/b', 'a/c/b', 'a/x/y/b'],
  'a/**/b': ['a/b', 'a/c/b', 'a/x/y/b'],
  '?.txt': ['1.txt', 'd/1.txt'],
  '*.{js,mjs,cjs}': [...JS.slice(0, 4), 'f.mjs', ...JS.slice(4)],
  'src/[abc]*.py': ['src/a1.py'],
  'dir/': ['dir/x', 'q/dir/x'],
  'marked.min.js': ['marked.min.js', 'vendor/marked.min.js'],
  'x+y(1)|$^.js': ['x+y(1)|$^.js'],
  '{a.b,c}/': ['a/c/b', 'a.b/z', 'c/z'],
  'interface/**/index-Dun7lr2S*.js': ['interface/q/index-Dun7lr2S.patched.js'],
};

for (const [glob, esperados] of Object.entries(CASAM)) {
  test(`casa: ${glob}`, () => {
    assert.deepStrictEqual(CAMINHOS.filter(caminho => casa(glob, caminho)), esperados);
  });
}

test('casaAlgum aceita texto e objeto com glob', () => {
  const globs = [{ glob: '*.py' }, '*.sh'];
  assert.strictEqual(casaAlgum(globs, 'a/b.py'), true);
  assert.strictEqual(casaAlgum(globs, 'b.sh'), true);
  assert.strictEqual(casaAlgum(globs, 'b.js'), false);
  assert.strictEqual(casaAlgum([], 'b.sh'), false);
});

test('extensaoDe devolve a última extensão em minúsculas', () => {
  assert.deepStrictEqual(['a.JS', 'b.tar.gz', 'sem', 'x/.env', 'y.d.TS', 'z.'].map(extensaoDe), ['js', 'gz', '', 'env', 'ts', '']);
});
