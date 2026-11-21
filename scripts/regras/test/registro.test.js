'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { conferir } = require('../registro-da-pr');
const { classificar } = require('../risco');
const { corpoComAProva, planejar } = require('../registrar-na-pr');
const { novasAltas } = require('../auditoria');

const HEAD = 'a'.repeat(40);
const OUTRO = 'b'.repeat(40);
const DESCRICAO = 'Corrige o botão do iPhone que mostrava Parar transmissão em vez de Abrir controle depois do patch do bundle.';
const REVISAO = head => `Registro de revisão independente\n\nVeredito: CLEAN\nHead: ${head}\nAutor: agente-a\nRevisor: agente-b\n`;
const PROVA = head => `## Prova real\n\nPROVADO 100% REAL\nHead: ${head}\n\nRodei o app no Mac e abri o cartão do iPhone: o botão mostrou Abrir controle.\n`;
const comum = { head: HEAD, rotulos: [], arquivos: [{ caminho: 'app/electron/pwa/app.js', adicionadas: ['const a = 1;'] }], registros: [REVISAO(HEAD)] };

test('registro passa: descrição, atenção BAIXA e revisão limpa no head', () => {
  const r = conferir({ ...comum, corpo: `## Resumo\n\n${DESCRICAO}\n\nAtenção: BAIXA\n` });
  assert.equal(r.ok, true, r.mensagem);
});

test('registro passa: atenção ALTA com prova real no head exato', () => {
  const r = conferir({ ...comum, corpo: `${DESCRICAO}\n\nAtenção: ALTA\n\n${PROVA(HEAD)}` });
  assert.equal(r.ok, true, r.mensagem);
});

test('registro falha: sem a linha de atenção', () => {
  const r = conferir({ ...comum, corpo: DESCRICAO });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /não tem a linha de atenção/);
});

test('registro falha: atenção com valor inválido, corpo vazio e atenção dentro de comentário HTML', () => {
  assert.match(conferir({ ...comum, corpo: `${DESCRICAO}\nAtenção: média-alta\n` }).mensagem, /não é BAIXA nem MÉDIA nem ALTA/);
  assert.match(conferir({ ...comum, corpo: 'Atenção: BAIXA' }).mensagem, /não descreve a mudança/);
  assert.match(conferir({ ...comum, corpo: `${DESCRICAO}\n<!-- Atenção: BAIXA -->` }).mensagem, /não tem a linha de atenção/);
});

test('registro falha: ALTA sem prova, com SHA abreviado, com SHA de outro commit e sem a frase', () => {
  const corpo = trecho => `${DESCRICAO}\nAtenção: ALTA\n\n${trecho}`;
  assert.match(conferir({ ...comum, corpo: corpo('') }).mensagem, /não tem a seção "Prova real"/);
  assert.match(conferir({ ...comum, corpo: corpo(PROVA(HEAD.slice(0, 8))) }).mensagem, /abreviado/);
  assert.match(conferir({ ...comum, corpo: corpo(PROVA(OUTRO)) }).mensagem, /o head mudou/);
  assert.match(conferir({ ...comum, corpo: corpo(`## Prova real\n\nHead: ${HEAD}\n`) }).mensagem, /não tem a linha PROVADO 100% REAL/);
});

test('registro falha: rótulo risco:alto exige a prova mesmo com atenção BAIXA', () => {
  const r = conferir({ ...comum, rotulos: ['risco:alto'], corpo: `${DESCRICAO}\nAtenção: BAIXA\n` });
  assert.match(r.mensagem, /não tem a seção "Prova real"/);
});

test('registro falha: caminho sensível com atenção BAIXA', () => {
  const r = conferir({ ...comum, arquivos: [{ caminho: 'app/electron/preload.js', adicionadas: [] }], corpo: `${DESCRICAO}\nAtenção: BAIXA\n` });
  assert.match(r.mensagem, /mexe em caminho sensível, e isso conta como ALTA, mas o corpo diz BAIXA/);
});

test('registro falha: sem revisão, revisão de outro head, veredito não limpo e revisor igual ao autor', () => {
  const corpo = `${DESCRICAO}\nAtenção: BAIXA\n`;
  assert.match(conferir({ ...comum, corpo, registros: [] }).mensagem, /nenhum comentário ou revisão/);
  assert.match(conferir({ ...comum, corpo, registros: [REVISAO(OUTRO)] }).mensagem, /o head mudou/);
  assert.match(conferir({ ...comum, corpo, registros: [REVISAO(HEAD).replace('CLEAN', 'MUDANÇAS')] }).mensagem, /não CLEAN/);
  assert.match(conferir({ ...comum, corpo, registros: [REVISAO(HEAD).replace('agente-b', 'agente-a')] }).mensagem, /próprio autor/);
});

test('registro: vale a revisão mais recente do head, e a de um registro citado em resposta não conta', () => {
  const corpo = `${DESCRICAO}\nAtenção: BAIXA\n`;
  const citado = `> ${REVISAO(HEAD).split('\n').join('\n> ')}`;
  assert.equal(conferir({ ...comum, corpo, registros: [citado] }).ok, false);
  assert.equal(conferir({ ...comum, corpo, registros: [REVISAO(OUTRO), REVISAO(HEAD)] }).ok, true);
});

test('classificador: caminhos sensíveis do Nova-AI contam como ALTA', () => {
  const sensiveis = [
    'app/electron/main.js', 'app/electron/preload.js', 'app/electron/services/identidade-ipc.js', 'app/electron/services/remote-access.js',
    'app/electron/services/global-spoof-service.js', 'app/electron/services/iphone-ssh.js', 'app/electron/services/ios-bridge.js',
    'app/electron/services/physicalMobileService.js', 'app/electron/services/child-worker-agent.js', 'app/package.json',
    'app/package-lock.json', 'MAC/integracao-iphone/conexao-usb/setup.js', 'MAC/proxy-iphone/instalar-proxy-iphone.command',
    '.github/workflows/regras.yml', 'scripts/regras/verificar.js', 'scripts/ci/codescene-na-refatoracao.js',
  ];
  for (const caminho of sensiveis) assert.equal(classificar([{ caminho, adicionadas: [] }]).alta, true, caminho);
});

test('classificador: arquivo comum não conta, e o conteúdo novo sensível conta', () => {
  assert.equal(classificar([{ caminho: 'app/electron/pwa/app.js', adicionadas: ['const a = 1;'] }]).alta, false);
  assert.equal(classificar([{ caminho: 'README.md', adicionadas: ['ipcMain.handle("x")'] }]).alta, false);
  for (const linha of ['ipcMain.handle("x", () => 1);', 'const { spawn } = require("child_process");', 'fs.rmSync(p, { recursive: true });', 'autoUpdater.checkForUpdates();', 'safeStorage.encryptString(s);']) {
    assert.equal(classificar([{ caminho: 'app/electron/pwa/app.js', adicionadas: [linha] }]).alta, true, linha);
  }
  assert.equal(classificar([{ caminho: 'app/electron/pwa/app.js', adicionadas: ['/^a.exec(x)/.exec(y); re.exec(z);'] }]).alta, false);
});

test('registrar-na-pr: recusa revisão de head antigo e prova com o autor igual ao revisor', () => {
  const pr = { ...comum, registros: [], corpo: `${DESCRICAO}\nAtenção: ALTA\n` };
  const antigo = planejar({ comando: 'revisao', head: OUTRO, autor: 'a', revisor: 'b', veredito: 'CLEAN' }, pr, '');
  assert.match(antigo.recusa, /um commit novo muda o head/);
  const mesmo = planejar({ comando: 'revisao', head: HEAD, autor: 'a', revisor: 'a', veredito: 'CLEAN' }, pr, '');
  assert.match(mesmo.recusa, /próprio autor/);
  const bom = planejar({ comando: 'revisao', head: HEAD, autor: 'a', revisor: 'b', veredito: 'CLEAN' }, pr, '');
  assert.match(bom.comentario, new RegExp(`Head: ${HEAD}`));
});

test('registrar-na-pr: a seção de prova entra no corpo e troca a anterior', () => {
  const corpo = `${DESCRICAO}\nAtenção: ALTA\n\n${PROVA(OUTRO)}\n## Outra\n\nfim\n`;
  const novo = corpoComAProva(corpo, `## Prova real\n\nPROVADO 100% REAL\nHead: ${HEAD}`);
  assert.ok(novo.includes(`Head: ${HEAD}`) && !novo.includes(OUTRO) && novo.includes('## Outra'));
  const plano = planejar({ comando: 'prova', head: HEAD, nota: 'x' }, { ...comum, corpo }, 'Rodei o app no Mac e abri o cartão do iPhone: o botão mostrou Abrir controle.');
  assert.equal(plano.depois.ok, true, plano.depois.mensagem);
});

test('auditoria: só vulnerabilidade alta ou crítica que a base não tinha', () => {
  const base = { vulnerabilities: { velho: { severity: 'high', via: [] } } };
  const ramo = { vulnerabilities: {
    velho: { severity: 'high', via: [] },
    novo: { severity: 'critical', range: '<2.0.0', via: [{ title: 'execução remota' }] },
    leve: { severity: 'moderate', via: [] },
  } };
  const novas = novasAltas(base, ramo);
  assert.deepEqual(novas.map(n => n.nome), ['novo']);
  assert.deepEqual(novasAltas(base, base), []);
  assert.equal(novasAltas(null, base).length, 1);
});
