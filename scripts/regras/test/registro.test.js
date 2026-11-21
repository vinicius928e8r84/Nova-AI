'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { conferir } = require('../registro-da-pr');
const { classificar } = require('../risco');
const { corpoComAProva, lerArgumentos, planejar } = require('../registrar-na-pr');
const { novasAltas } = require('../auditoria');

const HEAD = 'a'.repeat(40);
const OUTRO = 'b'.repeat(40);
const DESCRICAO = 'Corrige o botão do iPhone que mostrava Parar transmissão em vez de Abrir controle depois do patch do bundle.';
const REVISAO = (head, risco = 'BAIXA') => `Registro de revisão independente\n\nVeredito: CLEAN\nHead: ${head}\nAutor: agente-a\nRevisor: agente-b\nRisco: ${risco}\n`;
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
    'app/electron/main.js', 'app/electron/preload.js', 'app/electron/services/idioma-ipc.js', 'app/electron/services/remote-access.js',
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
  const antigo = planejar({ comando: 'revisao', head: OUTRO, autor: 'a', revisor: 'b', risco: 'ALTA', veredito: 'CLEAN' }, pr, '');
  assert.match(antigo.recusa, /um commit novo muda o head/);
  const mesmo = planejar({ comando: 'revisao', head: HEAD, autor: 'a', revisor: 'a', risco: 'ALTA', veredito: 'CLEAN' }, pr, '');
  assert.match(mesmo.recusa, /próprio autor/);
  const bom = planejar({ comando: 'revisao', head: HEAD, autor: 'a', revisor: 'b', risco: 'ALTA', veredito: 'CLEAN' }, pr, '');
  assert.match(bom.comentario, new RegExp(`Head: ${HEAD}\nAutor: a\nRevisor: b\nRisco: ALTA`));
});

test('registrar-na-pr: a seção de prova entra no corpo e troca a anterior', () => {
  const corpo = `${DESCRICAO}\nAtenção: ALTA\n\n${PROVA(OUTRO)}\n## Outra\n\nfim\n`;
  const novo = corpoComAProva(corpo, `## Prova real\n\nPROVADO 100% REAL\nHead: ${HEAD}`);
  assert.ok(novo.includes(`Head: ${HEAD}`) && !novo.includes(OUTRO) && novo.includes('## Outra'));
  const plano = planejar({ comando: 'prova', head: HEAD, cobertura: 'total', nota: 'x' }, { ...comum, corpo }, 'Rodei o app no Mac e abri o cartão do iPhone: o botão mostrou Abrir controle.');
  assert.equal(plano.depois.ok, true, plano.depois.mensagem);
});

test('registro: o risco do revisor sobe a atenção do corpo, e o do corpo não desce', () => {
  const media = conferir({ ...comum, corpo: `${DESCRICAO}\nAtenção: MÉDIA\n`, registros: [REVISAO(HEAD, 'ALTA')] });
  assert.equal(media.ok, false);
  assert.match(media.mensagem, /atenção ALTA \(o revisor disse Risco: ALTA, o corpo diz MÉDIA\): o corpo não tem a seção "Prova real"/);
  assert.equal(conferir({ ...comum, corpo: `${DESCRICAO}\nAtenção: MÉDIA\n\n${PROVA(HEAD)}`, registros: [REVISAO(HEAD, 'ALTA')] }).ok, true);
  assert.equal(conferir({ ...comum, corpo: `${DESCRICAO}\nAtenção: MÉDIA\n`, registros: [REVISAO(OUTRO, 'ALTA'), REVISAO(HEAD, 'MÉDIA')] }).ok, true);
  const alta = conferir({ ...comum, corpo: `${DESCRICAO}\nAtenção: ALTA\n`, registros: [REVISAO(HEAD, 'BAIXA')] });
  assert.match(alta.mensagem, /^ {4}- atenção ALTA: o corpo não tem a seção "Prova real"/m);
});

test('registro falha: revisão sem a linha Risco ou com um risco inválido', () => {
  const corpo = `${DESCRICAO}\nAtenção: BAIXA\n`;
  for (const registro of [REVISAO(HEAD).replace(/Risco: .*\n/, ''), REVISAO(HEAD, 'alto')]) {
    assert.match(conferir({ ...comum, corpo, registros: [registro] }).mensagem, /não diz o risco que o revisor viu/);
  }
  assert.equal(conferir({ ...comum, corpo, registros: [REVISAO(HEAD, 'media')] }).ok, true);
});

test('registro falha: PROVADO com a nota dizendo NÃO COBERTO ou BLOQUEADA', () => {
  const notas = [
    'NAO COBERTO: o GPS do iPhone', 'O GPS do iPhone ficou não coberto.', 'iPhone BLOQUEADA-iPhone sem cabo',
    'GPS do iPhone: NÃO COBERTA (aparelho fora do cabo).', 'casos não cobertos: GPS', 'parte real NAO COBERTA', 'iPhone e Android: não cobertas.',
    'iPhone bloqueado', 'iPhone e Android: BLOQUEADOS.', 'iPhone e Android: bloqueadas.', 'GPS: **NÃO** COBERTO.', 'GPS: NÃO-COBERTO.',
    '```text\nMac: ok\niPhone: NÃO COBERTO\n```', '~~~\n## iPhone\nbloqueado\n~~~', '> NÃO COBERTA: o GPS.', '  > > nao cobertos: o GPS e a câmera.',
  ];
  for (const nota of notas) {
    const r = conferir({ ...comum, corpo: `${DESCRICAO}\nAtenção: ALTA\n\n${PROVA(HEAD)}${nota}\n` });
    assert.equal(r.ok, false, nota);
    assert.match(r.mensagem, /prova parcial não vale como PROVADO 100% REAL/, nota);
  }
});

test('registro passa: NÃO COBERTO fora da seção Prova real ou em comentário de HTML não conta', () => {
  const comAProva = antes => `${DESCRICAO}\nAtenção: ALTA\n\n${antes}${PROVA(HEAD)}`;
  for (const corpo of [
    comAProva('```\n## Prova real\nNÃO COBERTO\n```\n\n'),
    comAProva('## Limites\n\nNÃO COBERTO: a versão antiga, fora do escopo.\n> BLOQUEADA\n\n'),
    `${comAProva('')}\n<!-- NÃO COBERTO: o GPS. -->\n\`\`\`text\nMac: ok\n\`\`\`\n> Abriu o cartão do iPhone.\n`,
  ]) {
    const r = conferir({ ...comum, corpo });
    assert.equal(r.ok, true, r.mensagem);
  }
});

test('registrar-na-pr: prova parcial escreve BLOQUEADA-iPhone e fica vermelha; total recusa nota suja', () => {
  const pr = { ...comum, corpo: `${DESCRICAO}\nAtenção: ALTA\n` };
  const nota = 'Rodei o app no Mac; o cartão do iPhone NÃO COBERTO porque o aparelho não estava no cabo.';
  const parcial = planejar({ comando: 'prova', head: HEAD, cobertura: 'parcial' }, pr, nota);
  assert.match(parcial.secao, /^BLOQUEADA-iPhone$/m);
  assert.doesNotMatch(parcial.corpo, /PROVADO 100% REAL/);
  assert.equal(parcial.depois.ok, false);
  assert.match(parcial.depois.mensagem, /diz BLOQUEADA/);
  assert.match(planejar({ comando: 'prova', head: HEAD, cobertura: 'total' }, pr, nota).recusa, /a nota diz NAO COBERTO/);
  for (const suja of ['GPS do iPhone: NÃO COBERTA (aparelho fora do cabo).', 'casos não cobertos: GPS', 'iPhone bloqueado', 'GPS: **NÃO** COBERTO.', '> NÃO-COBERTAS: GPS e câmera.']) {
    assert.match(planejar({ comando: 'prova', head: HEAD, cobertura: 'total' }, pr, suja).recusa || '', /a nota diz (NAO COBERT|BLOQUEAD)/, suja);
  }
  const limpa = planejar({ comando: 'prova', head: HEAD, cobertura: 'total' }, pr, 'Rodei o app no Mac e abri o cartão do iPhone: o botão mostrou Abrir controle.');
  assert.equal(limpa.depois.ok, true, limpa.depois.mensagem);
});

test('registrar-na-pr: revisao pede --risco e prova pede --cobertura', () => {
  const sha = ['--pr', '7', '--head', HEAD];
  assert.throws(() => lerArgumentos(['revisao', ...sha, '--autor', 'a', '--revisor', 'b']), /pede --risco/);
  assert.throws(() => lerArgumentos(['revisao', ...sha, '--autor', 'a', '--revisor', 'b', '--risco', 'alto']), /--risco é baixa, média, alta/);
  assert.equal(lerArgumentos(['revisao', ...sha, '--autor', 'a', '--revisor', 'b', '--risco', 'media']).risco, 'MÉDIA');
  assert.throws(() => lerArgumentos(['prova', ...sha, '--nota', 'n.md']), /pede --cobertura/);
  assert.throws(() => lerArgumentos(['prova', ...sha, '--nota', 'n.md', '--cobertura', 'meia']), /total ou parcial/);
  assert.equal(lerArgumentos(['prova', ...sha, '--nota', 'n.md', '--cobertura', 'parcial']).cobertura, 'parcial');
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
