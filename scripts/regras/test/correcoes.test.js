'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { criar, temEslint } = require('./auxiliar');
const { linhasDeComentario } = require('../comentarios');
const { acharNaLinha } = require('../regra-segredo');
const { conferir } = require('../registro-da-pr');
const { classificar } = require('../risco');

function tentar(regra, arquivos, base = {}, ajuste = () => {}) {
  const repo = criar(base);
  ajuste(repo);
  repo.escrever(arquivos);
  const resultado = repo.rodar('--regra', regra);
  repo.limpar();
  return resultado;
}

const AWS = `AKI${'A'}${'IOSFODNN7ABCDEFG'}`;
const HASH = ['5f4dcc3b5aa765d6', '1d8327deb882cf99'].join('');
const SENHA = ['Zx9fKq2', 'LmN8vB4'].join('');
const ANTIGO = { 'app/a.js': 'const a = 1;\nconst b = 2;\n' };
const SUJO = `const a = 1;\nconst b = 2;\nconsole.log(1); const sobra = "${AWS}";\nconst k = 1; // escondido\n`;

test('.gitattributes com -diff ou binary não desliga as regras de linha em arquivo que já existia', () => {
  for (const atributos of ['* -diff\n', '*.js binary\n', '*.js -diff -text\n']) {
    for (const regra of ['sem-comentario-novo', 'sem-segredo', 'sem-depuracao-esquecida']) {
      const r = tentar(regra, { 'app/a.js': SUJO, '.gitattributes': atributos }, ANTIGO);
      assert.equal(r.codigo, 1, `${regra} com ${JSON.stringify(atributos)}: ${r.saida}`);
    }
  }
});

test('.gitattributes e .gitmodules contam como caminho sensível', () => {
  assert.equal(classificar([{ caminho: '.gitattributes', adicionadas: [] }]).alta, true);
  assert.equal(classificar([{ caminho: '.gitmodules', adicionadas: [] }]).alta, true);
  assert.equal(classificar([{ caminho: '.github/CODEOWNERS', adicionadas: [] }]).alta, true);
});

test('arquivo existente com espaço, aspas ou tab no nome não some das regras de linha', () => {
  const nomes = ['app/com espaco.js', 'app/com"aspa.js', 'app/com\ttab.js', 'app/açaí.js'];
  const base = Object.fromEntries(nomes.map(nome => [nome, 'const a = 1;\n']));
  const novo = Object.fromEntries(nomes.map(nome => [nome, 'const a = 1;\nconst b = 2; // escondido\n']));
  const r = tentar('sem-comentario-novo', novo, base);
  assert.equal(r.codigo, 1, r.saida);
  for (const nome of nomes) assert.ok(r.saida.includes(`${nome}:2`), `${nome}\n${r.saida}`);
});

test('cópia idêntica de arquivo que já existe não escapa da regra de backup', () => {
  const base = { 'app/main.js': 'const a = 1;\n', 'app/package.json': '{}\n' };
  const r = tentar('sem-binario-nem-lixo', { 'app/main.js.bak-1': 'const a = 1;\n', 'app/package.json.antes-proxy': '{}\n', 'app/copia.js': 'const a = 1;\n' }, base);
  assert.equal(r.codigo, 1, r.saida);
  assert.ok(r.saida.includes('app/main.js.bak-1') && r.saida.includes('app/package.json.antes-proxy'), r.saida);
  assert.ok(!r.saida.includes('app/copia.js'), r.saida);
});

test('cópia idêntica continua isenta de comentário e a pasta reservas aceita o backup', () => {
  const base = { 'app/a.js': '// velho\nconst a = 1;\n' };
  const r = tentar('sem-binario-nem-lixo', { 'MAC/x/reservas/20261116/a.js.antes-patch': '// velho\nconst a = 1;\n' }, base);
  assert.equal(r.codigo, 0, r.saida);
});

test('arquivo novo grande não trava: o tempo não cresce com linhas × tamanho', { timeout: 60000 }, () => {
  const grande = Array.from({ length: 30000 }, (_, i) => `const valor${i} = ${i};`).join('\n');
  const inicio = Date.now();
  const r = tentar('sem-binario-nem-lixo', { 'app/dados.js': grande });
  assert.equal(r.codigo, 0, r.saida);
  assert.ok(Date.now() - inicio < 30000, `demorou ${Date.now() - inicio} ms`);
});

test('comentário novo em C, Objective-C, Swift, Logos, YAML, plist e script com shebang', () => {
  const arquivos = {
    'MAC/a.c': 'int a = 1; // por que\n',
    'MAC/b.m': '/* por que */\nint b;\n',
    'MAC/c.swift': 'let c = 1 // por que\n',
    'MAC/d.x': '// por que\n%hook A\n%end\n',
    '.github/e.yml': 'a: 1 # por que\n',
    'MAC/f.plist': '<plist><!-- por que --></plist>\n',
    'MAC/g': '#!/bin/sh\n# por que\necho oi\n',
    'MAC/h': '#!/usr/bin/env python3\nx = 1 # por que\n',
    'MAC/i': '#!/usr/bin/env node\nconst x = 1; // por que\n',
  };
  const r = tentar('sem-comentario-novo', arquivos);
  assert.equal(r.codigo, 1, r.saida);
  for (const nome of ['MAC/a.c:1', 'MAC/b.m:1', 'MAC/c.swift:1', 'MAC/d.x:1', '.github/e.yml:1', 'MAC/f.plist:1', 'MAC/g:2', 'MAC/h:2', 'MAC/i:2']) assert.ok(r.saida.includes(nome), `${nome}\n${r.saida}`);
});

test('sem comentário: texto com // e # dentro de string, e arquivo sem shebang, passam', () => {
  const r = tentar('sem-comentario-novo', {
    'MAC/a.c': 'const char *u = "http://x//y";\n',
    'MAC/c.swift': 'let c = "// não é comentário"\n',
    '.github/e.yml': 'a: "b # c"\nb: x#y\n',
    'MAC/dados': 'isto // não é código\n',
  });
  assert.equal(r.codigo, 0, r.saida);
});

test('eslint-disable não é mais diretiva permitida', () => {
  const r = tentar('sem-comentario-novo', { 'app/a.js': '/* eslint-disable */\nconst a = 1; // eslint-disable-line no-unused-vars\n' });
  assert.equal(r.codigo, 1, r.saida);
  assert.ok(r.saida.includes('app/a.js:1') && r.saida.includes('app/a.js:2'), r.saida);
});

test('pastas vendor, dist e fixtures fora do lugar previsto não escapam da regra de comentário', () => {
  const r = tentar('sem-comentario-novo', {
    'app/electron/services/vendor/x.js': '// por que\n',
    'app/electron/dist/y.js': '// por que\n',
    'app/fixtures/z.js': '// por que\n',
  });
  assert.equal(r.codigo, 1, r.saida);
  for (const nome of ['vendor/x.js', 'dist/y.js', 'fixtures/z.js']) assert.ok(r.saida.includes(nome), r.saida);
});

test('os lugares previstos continuam isentos: bundle da interface, reservas e backup', () => {
  const r = tentar('sem-comentario-novo', {
    'app/dist/assets/a.js': '// por que\n',
    'MAC/x/index-Dun7lr2S.patched.js': '// por que\n',
    'MAC/x/reservas/1/a.js': '// por que\n',
    'backup-antes-traducao/a.js': '// por que\n',
  });
  assert.equal(r.codigo, 0, r.saida);
});

test('separador de JS: comentário depois de i++ / n e i-- / n é achado', () => {
  const fonte = 'const r = i++ / b; // escondido um\nconst q = i-- / 2; // escondido dois\nconst c = a.b / 2 // tres\nconst re = /ab+c/.test(x); // quatro\n';
  assert.deepEqual(linhasDeComentario('a.js', fonte).map(l => l.corpo), ['escondido um', 'escondido dois', 'tres', 'quatro']);
});

test('depuração falha: console["log"], console.log sem chamada e console.log numa atribuição', () => {
  const r = tentar('sem-depuracao-esquecida', { 'app/a.js': 'console["log"](1);\nconst l = console.log;\nconsole . debug(2);\nconsole.error(3);\n' });
  assert.equal(r.codigo, 1, r.saida);
  for (const linha of ['app/a.js:1', 'app/a.js:2', 'app/a.js:3']) assert.ok(r.saida.includes(linha), r.saida);
  assert.ok(!r.saida.includes('app/a.js:4'), r.saida);
});

test('eslint: bundle da interface não é cobrado, globais do navegador existem e eslint-disable não vale', { skip: !temEslint }, () => {
  const bom = tentar('eslint-nas-linhas-novas', {
    'MAC/x/index-Dun7lr2S.patched.js': 'const u = import.meta.url;\nexport { u };\n',
    'app/b.js': 'const l = innerWidth + innerHeight + new VideoEncoder({}).length + new Path2D().length;\nmodule.exports = { l };\n',
  });
  assert.equal(bom.codigo, 0, bom.saida);
  const ruim = tentar('eslint-nas-linhas-novas', { 'app/c.js': '/* eslint-disable */\nconst naoUsada = 1;\nconsole.log(undefined == 1);\n' });
  assert.equal(ruim.codigo, 1, ruim.saida);
  assert.ok(ruim.saida.includes('no-unused-vars'), ruim.saida);
});

test('eslint: erro fatal em linha antiga que a mudança não tocou não falha', { skip: !temEslint }, () => {
  const base = { 'app/a.js': 'const a = ;\nconst b = 2;\n' };
  const r = tentar('eslint-nas-linhas-novas', { 'app/a.js': 'const a = ;\nconst b = 3;\n' }, base);
  assert.equal(r.codigo, 0, r.saida);
});

test('segredo: hash hexadecimal longo em campo de senha falha; URL de exemplo passa; URL com senha real falha', () => {
  assert.equal(acharNaLinha(`"senha": "${HASH}"`), 'valor literal em campo de segredo');
  assert.equal(acharNaLinha('esquema://usuario:senha@host:porta'), null);
  assert.equal(acharNaLinha('socks5://h:1002:usr:s3nh@x'), null);
  assert.equal(acharNaLinha(`http://admin:${SENHA}@10.0.0.1/`), 'URL com usuário e senha');
});

test('segredo e registro: entrada patológica não trava', { timeout: 30000 }, () => {
  let inicio = Date.now();
  acharNaLinha(`${'token.'.repeat(20000)}=`);
  acharNaLinha(`${'a.'.repeat(60000)}://x:y@`);
  assert.ok(Date.now() - inicio < 5000, `segredo demorou ${Date.now() - inicio} ms`);
  inicio = Date.now();
  conferir({ corpo: `# a${' '.repeat(100000)}b\n${'#'.repeat(50000)} x`, head: 'a'.repeat(40) });
  assert.ok(Date.now() - inicio < 5000, `registro demorou ${Date.now() - inicio} ms`);
});

test('segredo: linha enorme é varrida por janelas e o segredo no meio é achado', () => {
  const linha = `${'x'.repeat(5000)}"${AWS}"${'y'.repeat(5000)}`;
  assert.equal(acharNaLinha(linha), 'chave de acesso da AWS');
});

test('binário falha: .tar e .iso novos', () => {
  const r = tentar('sem-binario-nem-lixo', { 'app/a.tar': 'x', 'app/b.iso': 'x' });
  assert.equal(r.codigo, 1, r.saida);
});

test('lista de checks obrigatórios confere com os nomes dos jobs dos workflows', () => {
  const raiz = path.join(__dirname, '..', '..', '..');
  const { checks } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'checks-obrigatorios.json'), 'utf8'));
  const dosWorkflows = [];
  for (const arquivo of fs.readdirSync(path.join(raiz, '.github', 'workflows'))) {
    const texto = fs.readFileSync(path.join(raiz, '.github', 'workflows', arquivo), 'utf8');
    for (const m of texto.matchAll(/^ {4}name: (.+)$/gm)) dosWorkflows.push(m[1].trim());
  }
  assert.deepEqual([...dosWorkflows].sort(), [...checks].sort());
});

test('workflows: sem pull_request_target, ações presas por SHA e regras lidas da base', () => {
  const pasta = path.join(__dirname, '..', '..', '..', '.github', 'workflows');
  for (const arquivo of fs.readdirSync(pasta)) {
    const texto = fs.readFileSync(path.join(pasta, arquivo), 'utf8');
    assert.ok(!/pull_request_target/.test(texto), arquivo);
    for (const m of texto.matchAll(/uses: (\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${arquivo}: ${m[1]}`);
    assert.ok(texto.includes('git archive'), `${arquivo} não usa as regras da base`);
    assert.ok(!/^\s*#/m.test(texto), `${arquivo} tem comentário`);
  }
});

const HEAD = 'a'.repeat(40);
const ANTIGA = 'b'.repeat(40);
const DESCRICAO = 'Corrige o botão do iPhone que mostrava Parar transmissão em vez de Abrir controle depois do patch do bundle.';
const registro = (veredito, autor = 'agente-a', revisor = 'agente-b', head = HEAD) => `Veredito: ${veredito}\nHead: ${head}\nAutor: ${autor}\nRevisor: ${revisor}\n`;
const baseDoRegistro = { head: HEAD, arquivos: [{ caminho: 'README.md', adicionadas: [] }], corpo: `${DESCRICAO}\n\nAtenção: BAIXA\n` };

test('registro: NOT CLEAN no head é definitivo, venha antes ou depois de um CLEAN', () => {
  assert.equal(conferir({ ...baseDoRegistro, registros: [registro('CLEAN')] }).ok, true);
  for (const registros of [[registro('NOT CLEAN'), registro('CLEAN')], [registro('CLEAN'), registro('NOT CLEAN')]]) {
    const r = conferir({ ...baseDoRegistro, registros });
    assert.equal(r.ok, false);
    assert.match(r.mensagem, /não se desfaz com outro comentário/);
  }
  assert.equal(conferir({ ...baseDoRegistro, registros: [registro('NOT CLEAN', 'a', 'b', ANTIGA), registro('CLEAN')] }).ok, true);
});

test('registro: o revisor não pode ser quem abriu a PR', () => {
  const r = conferir({ ...baseDoRegistro, autor: 'Dona-da-PR', registros: [registro('CLEAN', 'agente-a', 'dona-da-pr')] });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /é quem abriu a PR/);
});

test('registro: a linha Head com dois SHAs não vale, nem na revisão nem na prova', () => {
  const dois = `Veredito: CLEAN\nHead: ${ANTIGA} ${HEAD}\nAutor: a\nRevisor: b\n`;
  assert.equal(conferir({ ...baseDoRegistro, registros: [dois] }).ok, false);
  const prova = `${DESCRICAO}\nAtenção: ALTA\n\n## Prova real\n\nPROVADO 100% REAL\nHead: ${ANTIGA} ${HEAD}\n\nRodei o app no Mac e abri o cartão do iPhone: o botão mostrou Abrir controle.\n`;
  assert.match(conferir({ ...baseDoRegistro, corpo: prova, registros: [registro('CLEAN')] }).mensagem, /mais do que o SHA do head/);
});

test('registro: a prova precisa explicar o que foi provado', () => {
  const sem = `${DESCRICAO}\nAtenção: ALTA\n\n## Prova real\n\nPROVADO 100% REAL\nHead: ${HEAD}\n`;
  assert.match(conferir({ ...baseDoRegistro, corpo: sem, registros: [registro('CLEAN')] }).mensagem, /não explica o que foi provado/);
  const com = `${sem}\nRodei o app no Mac e abri o cartão do iPhone: o botão mostrou Abrir controle.\n`;
  assert.equal(conferir({ ...baseDoRegistro, corpo: com, registros: [registro('CLEAN')] }).ok, true);
});

test('registro: arquivo sem diff devolvido pela API conta como risco ALTA', () => {
  const r = conferir({ ...baseDoRegistro, arquivos: [{ caminho: 'app/electron/pwa/app.js', adicionadas: null }], registros: [registro('CLEAN')] });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /diff-ausente|não devolveu o diff/);
});
