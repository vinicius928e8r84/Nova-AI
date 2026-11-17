'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { criar } = require('./auxiliar');
const { linhasDeComentario } = require('../comentarios');
const { acharNaLinha } = require('../regra-segredo');
const { conferir } = require('../registro-da-pr');

const RAIZ = path.join(__dirname, '..', '..', '..');
const AWS = `AKI${'A'}${'IOSFODNN7ABCDEFG'}`;
const SUJO_HTML = `<!-- comentario novo -->\n<p>oi</p>\n<script>console.log(1); const apiKey = "${AWS}";</script>\n`;

function tentar(regra, arquivos, base = {}, ajuste = () => {}) {
  const repo = criar(base);
  ajuste(repo);
  repo.escrever(arquivos);
  const resultado = repo.rodar('--regra', regra);
  repo.limpar();
  return resultado;
}

const utf16 = (texto, comBom) => Buffer.concat([comBom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(texto, 'utf16le')]);
const utf16Grande = texto => Buffer.from(texto, 'utf16le').swap16();

test('workflow: os testes do PR rodam depois das regras, nunca antes', () => {
  const texto = fs.readFileSync(path.join(RAIZ, '.github', 'workflows', 'regras.yml'), 'utf8');
  const regras = texto.indexOf('- name: Regras de revisão');
  const testes = texto.indexOf('- name: Testes das regras');
  assert.ok(regras > 0 && testes > regras, 'Testes das regras tem de vir depois de Regras de revisão');
  assert.ok(!texto.slice(testes, texto.indexOf('\n  auditoria:')).includes('REGRAS_DIR'), 'nada depois dos testes pode usar REGRAS_DIR');
});

test('UTF-16 não escapa das regras de conteúdo (com BOM, sem BOM, big endian e working-tree-encoding)', () => {
  const JS = 'const a = 1; // novo\nconsole.log(a);\n';
  const formas = {
    'com BOM': texto => utf16(texto, true),
    'sem BOM': texto => utf16(texto, false),
    'big endian': utf16Grande,
  };
  for (const [nome, codificar] of Object.entries(formas)) {
    for (const regra of ['sem-comentario-novo', 'sem-segredo']) {
      const r = tentar(regra, { 'app/electron/pwa/novo.html': codificar(SUJO_HTML) });
      assert.equal(r.codigo, 1, `${nome} ${regra}: ${r.saida}`);
    }
    for (const regra of ['sem-comentario-novo', 'sem-depuracao-esquecida']) {
      const r = tentar(regra, { 'app/electron/novo.js': codificar(JS) });
      assert.equal(r.codigo, 1, `${nome} js ${regra}: ${r.saida}`);
    }
  }
  for (const regra of ['sem-comentario-novo', 'sem-segredo']) {
    const repo = criar();
    repo.escrever({ 'app/electron/pwa/.gitattributes': 'novo.html working-tree-encoding=UTF-16\n', 'app/electron/pwa/novo.html': utf16(SUJO_HTML, true) });
    repo.guardar('utf16 por atributo');
    const r = repo.rodar('--regra', regra);
    repo.limpar();
    assert.equal(r.codigo, 1, `working-tree-encoding ${regra}: ${r.saida}`);
  }
});

test('UTF-16 limpo continua passando', () => {
  const r = tentar('sem-comentario-novo', { 'app/electron/pwa/novo.html': utf16('<p>oi</p>\n', true) });
  assert.equal(r.codigo, 0, r.saida);
});

test('segredo dentro de arquivo binário sem assinatura conhecida é achado', () => {
  const miolo = Buffer.concat([Buffer.from([0, 1, 2, 3, 0, 0]), Buffer.from(`x ${AWS} y`), Buffer.from([0, 0, 9, 0])]);
  assert.equal(tentar('sem-segredo', { 'app/electron/dados.dat': miolo }).codigo, 1);
  const largo = Buffer.concat([Buffer.from([0, 0, 1, 2]), Buffer.from(AWS, 'utf16le'), Buffer.from([0, 0])]);
  assert.equal(tentar('sem-segredo', { 'app/electron/dados2.dat': largo }).codigo, 1);
  const limpo = Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7919) % 251));
  assert.equal(tentar('sem-segredo', { 'app/electron/dados3.dat': limpo }).codigo, 0);
});

test('segredo já existente num binário que a mudança toca não falha; novo falha', () => {
  const base = { 'app/electron/dados.dat': Buffer.concat([Buffer.from([0, 1, 0, 2]), Buffer.from(AWS), Buffer.from([0])]) };
  const r = tentar('sem-segredo', { 'app/electron/dados.dat': Buffer.concat([Buffer.from([0, 9, 0, 2]), Buffer.from(AWS), Buffer.from([0])]) }, base);
  assert.equal(r.codigo, 0, r.saida);
});

test('binário: arquivo modificado que vira executável, gzip ou passa de tamanho falha', () => {
  const base = { 'app/electron/pwa/admin.html': '<p>oi</p>\n', 'README.md': '# oi\n' };
  const gz = zlib.gzipSync(Buffer.from('const a = 1;\n'));
  assert.equal(tentar('sem-binario-nem-lixo', { 'app/electron/pwa/admin.html': gz }, base).codigo, 1);
  assert.equal(tentar('sem-binario-nem-lixo', { 'README.md': Buffer.from('a'.repeat(9 * 1024 * 1024)) }, base).codigo, 1);
  assert.equal(tentar('sem-binario-nem-lixo', { 'README.md': '# oi\n\nmais uma linha\n' }, base).codigo, 0);
});

test('binário: arquivo que já passava do limite e é modificado de novo não falha', () => {
  const grande = Buffer.from('a'.repeat(9 * 1024 * 1024));
  const r = tentar('sem-binario-nem-lixo', { 'README.md': Buffer.from(`b${'a'.repeat(9 * 1024 * 1024)}`) }, { 'README.md': grande });
  assert.equal(r.codigo, 0, r.saida);
});

test('comentário depois de propriedade com nome de palavra-chave e divisão é achado', () => {
  for (const palavra of ['return', 'typeof', 'in', 'of', 'delete', 'void', 'yield', 'await']) {
    for (const acesso of ['.', '?.']) {
      const achados = linhasDeComentario('a.js', `const a1 = o${acesso}${palavra} / 2; // h1\n`);
      assert.equal(achados.length, 1, `${acesso}${palavra}`);
    }
  }
  assert.equal(linhasDeComentario('a.js', 'function f(o) { return /x/.test(o); // h1\n}\n').length, 1);
});

test('segredo: atribuição longa na fronteira da janela é achada em qualquer deslocamento', () => {
  const valor = Array.from({ length: 300 }, (_, i) => `Ab${i % 10}x`).join('');
  for (let preenchimento = 1500; preenchimento < 2100; preenchimento += 37) {
    assert.ok(acharNaLinha(`${' '.repeat(preenchimento)}apiKey: "${valor}"`), `preenchimento ${preenchimento}`);
  }
  assert.equal(acharNaLinha(`${' '.repeat(1900)}apiKey: process.env.API_KEY`), null);
});

test('segredo: token do Telegram colado em bot na URL é achado', () => {
  const token = `${'123456789'}:${'AAH'}${'x'.repeat(10)}${'Y'.repeat(10)}${'z'.repeat(12)}`;
  assert.equal(acharNaLinha(`fetch("https://api.telegram.org/bot${token}/sendMessage")`), 'token de bot do Telegram');
});

test('comentário novo em Makefile, .cmd, .bat, .go e .rs falha', () => {
  const casos = {
    'tool/Makefile': 'all:\n\techo oi\n# comentario novo\n',
    'tool/nova.cmd': '@echo off\nrem comentario novo\n',
    'tool/nova.bat': '@echo off\n:: comentario novo\n',
    'tool/nova.go': 'package main\n// comentario novo\n',
    'tool/nova.rs': 'fn main() {}\n// comentario novo\n',
  };
  for (const [arquivo, texto] of Object.entries(casos)) {
    assert.equal(tentar('sem-comentario-novo', { [arquivo]: texto }).codigo, 1, arquivo);
  }
  assert.equal(tentar('sem-comentario-novo', { 'tool/Makefile': 'all:\n\techo "# nao e comentario"\n' }).codigo, 0);
  assert.equal(tentar('sem-comentario-novo', { 'tool/nova.cmd': '@echo off\necho remover\n' }).codigo, 0);
});

test('copiar ou mover arquivo de pasta isenta para o código cobra comentário', () => {
  const antigo = 'const a = 1;\n// comentario antigo\nconst b = 2;\n';
  const base = { 'backup-antes-traducao/pwa/app.js': antigo };
  const copia = tentar('sem-comentario-novo', { 'app/electron/servico-copiado.js': antigo }, base);
  assert.equal(copia.codigo, 1, copia.saida);
  const mover = tentar('sem-comentario-novo', { 'backup-antes-traducao/pwa/app.js': null, 'app/electron/novo/app2.js': antigo }, base, repo => repo.git('rm', '-q', '--cached', 'backup-antes-traducao/pwa/app.js'));
  assert.equal(mover.codigo, 1, mover.saida);
  const reserva = tentar('sem-comentario-novo', { 'MAC/x/reservas/app.js': antigo }, base);
  assert.equal(reserva.codigo, 0, reserva.saida);
});

test('renomeação de arquivo de código comum com comentário antigo continua isenta', () => {
  const antigo = 'const a = 1;\n// comentario antigo\nconst b = 2;\n';
  const r = tentar('sem-comentario-novo', { 'app/a.js': null, 'app/b.js': antigo }, { 'app/a.js': antigo });
  assert.equal(r.codigo, 0, r.saida);
});

test('registro: título de seção com \\r solto não trava o conferir', { timeout: 20000 }, () => {
  const corpo = `#${' '.repeat(60000)}\rx\ry\n`;
  const inicio = Date.now();
  conferir({ head: 'a'.repeat(40), arquivos: [{ caminho: 'README.md', adicionadas: [] }], corpo, registros: [] });
  assert.ok(Date.now() - inicio < 1500, `levou ${Date.now() - inicio} ms`);
});

test('binário de tamanho ímpar e par é varrido sem quebrar', () => {
  for (const tamanho of [1, 2, 3, 4001, 4002]) {
    const buffer = Buffer.alloc(tamanho, 1);
    buffer[0] = 0;
    const r = tentar('sem-segredo', { 'app/electron/impar.dat': buffer });
    assert.equal(r.codigo, 0, `tamanho ${tamanho}: ${r.saida}`);
  }
});

const NUL_NO_COMECO = 'const zz = "\0";\nmodule.exports.zz = zz;\n// comentario novo\nconsole.log(zz);\n';
const preenchimento = quantas => Array.from({ length: quantas }, (_, i) => `module.exports.v${i} = ${i};\n`).join('');

test('byte nulo em arquivo de código não desliga as regras de linha', () => {
  const novo = tentar('sem-binario-nem-lixo', { 'app/electron/services/grande.js': NUL_NO_COMECO + preenchimento(3000) });
  assert.equal(novo.codigo, 1, novo.saida);
  const base = { 'app/electron/main.js': preenchimento(10) };
  const crescido = tentar('sem-binario-nem-lixo', { 'app/electron/main.js': NUL_NO_COMECO + preenchimento(10) }, base);
  assert.equal(crescido.codigo, 1, crescido.saida);
  const script = tentar('sem-binario-nem-lixo', { 'scripts/sem-extensao': '#!/bin/sh\necho "\0"\n' });
  assert.equal(script.codigo, 1, script.saida);
});

test('byte nulo: arquivo que não é código e JS limpo continuam passando', () => {
  const png = Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7919) % 251));
  const r = tentar('sem-binario-nem-lixo', { 'app/electron/icone.png': png, 'app/electron/services/limpo.js': preenchimento(5) });
  assert.equal(r.codigo, 0, r.saida);
});

test('UTF-16 com BOM sem byte nulo nos primeiros 8000 bytes ainda é decodificado', () => {
  const texto = `${'中'.repeat(4100)}\n${SUJO_HTML}`;
  for (const regra of ['sem-comentario-novo', 'sem-segredo']) {
    const r = tentar(regra, { 'app/electron/pwa/cjk.html': utf16(texto, true) });
    assert.equal(r.codigo, 1, `${regra}: ${r.saida}`);
  }
});

test('comentário em sintaxe HTML e shebang com texto dentro de JS são achados', () => {
  const casos = ['x();\n--> escondido1\n', 'const a = 1 <!-- escondido2\n', '<!-- escondido3\nx();\n', '#!/usr/bin/env node comentario escondido no shebang\nx();\n'];
  for (const [i, texto] of casos.entries()) {
    const r = tentar('sem-comentario-novo', { [`app/electron/services/h${i}.js`]: texto });
    assert.equal(r.codigo, 1, `${i}: ${r.saida}`);
  }
  for (const bom of ['#!/usr/bin/env node\nx();\n', '#!/usr/bin/env -S node --no-warnings\nx();\n', 'const a = 1 < !--b;\n', 'const s = "<!-- nao e comentario -->";\n']) {
    const r = tentar('sem-comentario-novo', { 'app/electron/services/bom.js': bom });
    assert.equal(r.codigo, 0, `${JSON.stringify(bom)}: ${r.saida}`);
  }
});

test('comentário em .bat com @rem e depois de & é achado', () => {
  for (const texto of ['@echo off\n@rem por que\n', 'echo oi & rem por que\n', 'echo oi && rem por que\n']) {
    assert.equal(tentar('sem-comentario-novo', { 'tool/nova.bat': texto }).codigo, 1, texto);
  }
  assert.equal(tentar('sem-comentario-novo', { 'tool/nova.bat': 'echo remover & echo oi\n' }).codigo, 0);
});

test('registro: NOT CLEAN com a linha Head mal formatada continua definitivo', () => {
  const head = 'a'.repeat(40);
  const ruim = `Veredito: NOT CLEAN\nHead: ${head} (atual)\nAutor: x\nRevisor: y\n`;
  const bom = `Veredito: CLEAN\nHead: ${head}\nAutor: x2\nRevisor: y2\n`;
  const r = conferir({ head, arquivos: [{ caminho: 'README.md', adicionadas: [] }], corpo: `${'Corrige o botão do iPhone que mostrava Parar transmissão.'.repeat(2)}\n\nAtenção: BAIXA\n`, registros: [ruim, bom] });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /não se desfaz com outro comentário/);
});

const SENHA_FORTE = ['Sup3r', 'S3cret'].join('');

test('segredo: exemplos de URL de proxy do repositório não são segredo, senha real continua sendo', () => {
  const livres = [
    'esquema://host:porta@usuario:senha',
    'check(@"socks5://h.exemplo.com:1002@usr:senha", @"socks5")',
    'eq("x", P.parse("http://aquiles:segredo123@us.exemplo.com:8080"))',
    '"socks5h://aquiles:pa:ss@host.exemplo.com:1080"',
    'const SENHA = "segredoFalso_country-US_mode-quality_session-AAAABBBB_lifetime-1440";',
  ];
  for (const linha of livres) assert.equal(acharNaLinha(linha), null, linha);
  assert.equal(acharNaLinha(`postgres://admin:${SENHA_FORTE}@db.interno.com/x`), 'URL com usuário e senha');
  assert.equal(acharNaLinha(`postgres://admin:${SENHA_FORTE}@db.exemplo.com.evil.io/x`), 'URL com usuário e senha');
});

test('script ou código com BOM de UTF-16 não escapa: código entra em UTF-8', () => {
  const sh = utf16('#!/bin/sh\n# comentario novo escondido\necho oi\n', true);
  const novo = tentar('sem-binario-nem-lixo', { 'MAC/scripts-n/instalar.sh': sh });
  assert.equal(novo.codigo, 1, novo.saida);
  const cmd = tentar('sem-binario-nem-lixo', { 'app/nova-locale.cmd': utf16('rem comentario novo\n', true) });
  assert.equal(cmd.codigo, 1, cmd.saida);
  const modificado = tentar('sem-binario-nem-lixo', { 'MAC/scripts-n/instalar.sh': sh }, { 'MAC/scripts-n/instalar.sh': '#!/bin/sh\necho oi\n' });
  assert.equal(modificado.codigo, 1, modificado.saida);
  const texto = tentar('sem-binario-nem-lixo', { 'docs/notas.txt': utf16('notas\n', true), 'MAC/scripts-n/limpo.sh': '#!/bin/sh\necho oi\n' });
  assert.equal(texto.codigo, 0, texto.saida);
});

const EVOMI = ['Kx9mP2', 'vLq8RtZw'].join('');

test('segredo: URL de proxy no formato invertido da Evomi e senha com outro @exemplo.com depois são achadas', () => {
  const ruins = [
    `"http://core-residential.evomi.com:1000@aquiles77:${EVOMI}"`,
    `'socks5://rp.evomi.com:1002@cliente9:${EVOMI}'`,
    `"https://admin:${EVOMI}@api.interno.io/v1?avisar=ops@example.com"`,
    `"https://admin:${EVOMI}@api.interno.io/#@exemplo.com"`,
  ];
  for (const linha of ruins) assert.equal(acharNaLinha(linha), 'URL com usuário e senha', linha);
});

test('shebang: regex linear e linha com CRLF não é comentário novo', { timeout: 20000 }, () => {
  const inicio = Date.now();
  const r = tentar('sem-comentario-novo', { 'tool/longo.sh': `#!/x${' -a'.repeat(60000)} !\necho oi\n` });
  assert.ok(Date.now() - inicio < 8000, `levou ${Date.now() - inicio} ms`);
  assert.equal(r.codigo, 1, r.saida);
  for (const [arquivo, texto] of [['tool/crlf.sh', '#!/bin/bash\r\necho oi\r\n'], ['tool/crlf.cjs', '#!/usr/bin/env node\r\nx();\r\n']]) {
    const ok = tentar('sem-comentario-novo', { [arquivo]: texto });
    assert.equal(ok.codigo, 0, `${arquivo}: ${ok.saida}`);
  }
});
