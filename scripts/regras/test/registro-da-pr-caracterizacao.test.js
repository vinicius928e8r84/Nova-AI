'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  ATENCOES, BLOQUEADA, FRASE, ROTULO_DE_RISCO_ALTO, SECAO_DA_PROVA, arquivosSoComComentarioRemovido, atencaoValida, conferir, faltaDaProva,
  faltaDaRevisao, lerDoGitHub, linhasQueValem, marcaDeProvaParcial, tituloDe,
} = require('../registro-da-pr');
const { criar } = require('./auxiliar');

const REGISTRO_DA_PR = path.join(__dirname, '..', 'registro-da-pr.js');
const HEAD = 'a'.repeat(40);
const OUTRO = 'b'.repeat(40);
const DESCRICAO = 'Corrige o botão do iPhone que mostrava Parar transmissão em vez de Abrir controle depois do patch.';
const EXPLICACAO = 'Rodei o app no Mac e abri o cartão do iPhone: o botão mostrou Abrir controle.';
const comum = { head: HEAD, rotulos: [], arquivos: [{ caminho: 'app/x.js', adicionadas: ['const a = 1;'] }], registros: [revisao(HEAD)] };

function revisao(head, { veredito = 'CLEAN', autor = 'agente-a', revisor = 'agente-b', risco = 'BAIXA' } = {}) {
  return `Veredito: ${veredito}\nHead: ${head}\nAutor: ${autor}\nRevisor: ${revisor}\nRisco: ${risco}\n`;
}

const prova = (head, texto = EXPLICACAO) => `## Prova real\n\nPROVADO 100% REAL\nHead: ${head}\n\n${texto}\n`;
const corpoBaixa = `${DESCRICAO}\nAtenção: BAIXA\n`;
const corpoAlta = trecho => `${DESCRICAO}\nAtenção: ALTA\n\n${trecho}`;

const faltasDe = resultado => resultado.mensagem.split('\n').filter(linha => linha.startsWith('    - ')).map(linha => linha.slice(6));

function faltasDaPr(entrada) {
  const resultado = conferir({ ...comum, ...entrada });
  assert.equal(resultado.ok, false, resultado.mensagem);
  return faltasDe(resultado);
}

test('registro: o que passa diz a atenção, a revisão e, na ALTA, a frase da prova', () => {
  assert.deepEqual(conferir({ ...comum, corpo: corpoBaixa }), { ok: true, mensagem: `registro da PR ok no head ${HEAD}: atenção BAIXA, revisão CLEAN` });
  assert.deepEqual(conferir({ ...comum, corpo: corpoAlta(prova(HEAD)) }), {
    ok: true, mensagem: `registro da PR ok no head ${HEAD}: atenção ALTA, revisão CLEAN, PROVADO 100% REAL`,
  });
});

test('registro: a mensagem de falha tem o cabeçalho, uma linha por falta, o conserto e o comando que registra', () => {
  const resultado = conferir({ ...comum, corpo: '', registros: [] });
  const linhas = resultado.mensagem.split('\n');
  assert.equal(resultado.ok, false);
  assert.equal(linhas[0], `✗ O registro da PR não vale para o head ${HEAD}:`);
  assert.equal(linhas[1], '    - o corpo não descreve a mudança (escreva ao menos 40 caracteres sobre o que muda e por quê)');
  assert.equal(linhas[2], '    - o corpo não tem a linha de atenção (uma linha "Atenção: BAIXA", "Atenção: MÉDIA", "Atenção: ALTA")');
  assert.equal(linhas[3], '    - nenhum comentário ou revisão da PR é o registro de revisão independente (linhas "Veredito: CLEAN", "Head: <SHA>", "Autor:", "Revisor:" e "Risco:")');
  assert.equal(linhas[4], '  Conserto: o formato de cada parte está em .github/PULL_REQUEST_TEMPLATE.md e no CONTRIBUTING.md. O que está em comentário de HTML, em bloco de código ou em citação não conta; na seção "Prova real", a parte não coberta ou bloqueada conta também no código e na citação.');
  assert.equal(linhas[5], '  Registrar a revisão e a prova com o head lido do GitHub: node scripts/regras/registrar-na-pr.js --help');
  assert.equal(linhas.length, 6);
});

test('registro: corpo ausente conta como corpo vazio', () => {
  assert.deepEqual(faltasDaPr({ corpo: undefined }), [
    'o corpo não descreve a mudança (escreva ao menos 40 caracteres sobre o que muda e por quê)',
    'o corpo não tem a linha de atenção (uma linha "Atenção: BAIXA", "Atenção: MÉDIA", "Atenção: ALTA")',
  ]);
});

test('descrição: o cabeçalho, a atenção, o head e a frase da prova não contam como descrição', () => {
  assert.deepEqual(faltasDaPr({ corpo: '## Resumo\nAtenção: BAIXA\nHead: x\nPROVADO 100% REAL\ncurta\n' }), [
    'o corpo não descreve a mudança (escreva ao menos 40 caracteres sobre o que muda e por quê)',
  ]);
  assert.equal(conferir({ ...comum, corpo: `${DESCRICAO.slice(0, 39)}\nAtenção: BAIXA\n` }).ok, false);
  assert.equal(conferir({ ...comum, corpo: `${DESCRICAO.slice(0, 40)}\nAtenção: BAIXA\n` }).ok, true);
  assert.equal(conferir({ ...comum, corpo: `\`\`\`\n${DESCRICAO}\n\`\`\`\n> ${DESCRICAO}\n<!-- ${DESCRICAO} -->\nAtenção: BAIXA\n` }).ok, false);
});

test('atenção: aceita caixa, acento e marcação; recusa duas diferentes, valor estranho e a que está em comentário', () => {
  for (const escrita of ['baixa', 'Baixa', '**BAIXA**', 'BAIXA.', 'BAIXA!']) {
    assert.equal(conferir({ ...comum, corpo: `${DESCRICAO}\nAtenção: ${escrita}\n` }).ok, true, escrita);
  }
  assert.equal(conferir({ ...comum, corpo: `${DESCRICAO}\natencao: media\nATENÇÃO: média\n` }).ok, true);
  assert.deepEqual(faltasDaPr({ corpo: `${DESCRICAO}\nAtenção: BAIXA\nAtenção: ALTA\n` }), ['o corpo diz mais de uma atenção (BAIXA e ALTA)']);
  assert.equal(conferir({ ...comum, corpo: `${DESCRICAO}\nAtenção: BAIXA\nAtenção: baixa\n` }).ok, true);
});

test('atenção: valor que não é uma das três e atenção escondida', () => {
  assert.deepEqual(faltasDaPr({ corpo: `${DESCRICAO}\nAtenção: média-alta\n` }), ['a atenção "média-alta" do corpo não é BAIXA nem MÉDIA nem ALTA (o valor sozinho na linha)']);
  assert.deepEqual(faltasDaPr({ corpo: `${DESCRICAO}\n<!-- Atenção: BAIXA -->\n` }), [
    'o corpo não tem a linha de atenção (uma linha "Atenção: BAIXA", "Atenção: MÉDIA", "Atenção: ALTA")',
  ]);
  assert.equal(faltasDaPr({ corpo: `${DESCRICAO}\n> Atenção: BAIXA\n` }).length, 1);
});

test('atenção: vale a maior entre a do corpo, a do revisor, o rótulo e os caminhos sensíveis', () => {
  const semProva = 'atenção ALTA: o corpo não tem a seção "Prova real"';
  assert.deepEqual(faltasDaPr({ corpo: corpoBaixa, registros: [revisao(HEAD, { risco: 'alta' })] }), [
    'atenção ALTA (o revisor disse Risco: ALTA, o corpo diz BAIXA): o corpo não tem a seção "Prova real"',
  ]);
  assert.deepEqual(faltasDaPr({ corpo: `${DESCRICAO}\nAtenção: média\n`, registros: [revisao(HEAD, { risco: 'ALTA' })] }), [
    'atenção ALTA (o revisor disse Risco: ALTA, o corpo diz MÉDIA): o corpo não tem a seção "Prova real"',
  ]);
  assert.deepEqual(faltasDaPr({ corpo: DESCRICAO, registros: [revisao(HEAD, { risco: 'ALTA' })] }), [
    'o corpo não tem a linha de atenção (uma linha "Atenção: BAIXA", "Atenção: MÉDIA", "Atenção: ALTA")',
    'atenção ALTA (o revisor disse Risco: ALTA, o corpo diz nada): o corpo não tem a seção "Prova real"',
  ]);
  assert.deepEqual(faltasDaPr({ corpo: corpoBaixa, rotulos: [ROTULO_DE_RISCO_ALTO] }), [semProva]);
  assert.deepEqual(faltasDaPr({ corpo: corpoBaixa, rotulos: ['Risco:Alto'] }), [semProva]);
  assert.equal(conferir({ ...comum, corpo: corpoBaixa, rotulos: ['risco:medio', 'outro'] }).ok, true);
  assert.equal(conferir({ ...comum, corpo: corpoAlta(prova(HEAD)), registros: [revisao(HEAD, { risco: 'BAIXA' })] }).ok, true);
  assert.equal(conferir({ ...comum, corpo: corpoAlta(prova(HEAD)), registros: [revisao(HEAD, { risco: 'ALTA' })] }).ok, true);
  assert.equal(conferir({ ...comum, corpo: corpoBaixa, registros: [revisao(OUTRO, { risco: 'ALTA' }), revisao(HEAD)] }).ok, true);
});

test('caminho sensível: lista os arquivos e os motivos, pede a prova e é dispensado se o arquivo só perdeu comentário', () => {
  const arquivos = [{ caminho: 'app/electron/preload.js', adicionadas: [] }, { caminho: 'app/electron/main.js', adicionadas: [] }];
  assert.deepEqual(faltasDaPr({ corpo: corpoBaixa, arquivos }), [
    'a PR mexe em caminho sensível, e isso conta como ALTA, mas o corpo diz BAIXA: app/electron/preload.js (ipc-e-preload: processo principal, preload e canais IPC); app/electron/main.js (ipc-e-preload: processo principal, preload e canais IPC)',
    'atenção ALTA: o corpo não tem a seção "Prova real"',
  ]);
  assert.deepEqual(faltasDaPr({ corpo: `${DESCRICAO}\nAtenção: MÉDIA\n`, arquivos: [arquivos[0]] }).slice(0, 1), [
    'a PR mexe em caminho sensível, e isso conta como ALTA, mas o corpo diz MÉDIA: app/electron/preload.js (ipc-e-preload: processo principal, preload e canais IPC)',
  ]);
  assert.deepEqual(faltasDaPr({ corpo: DESCRICAO, arquivos: [arquivos[0]] }), [
    'o corpo não tem a linha de atenção (uma linha "Atenção: BAIXA", "Atenção: MÉDIA", "Atenção: ALTA")',
    'atenção ALTA: o corpo não tem a seção "Prova real"',
  ]);
  assert.equal(conferir({ ...comum, corpo: corpoBaixa, arquivos, semComentario: new Set(arquivos.map(arquivo => arquivo.caminho)) }).ok, true);
  assert.equal(conferir({ ...comum, corpo: corpoAlta(prova(HEAD)), arquivos }).ok, true);
  const seis = Array.from({ length: 7 }, (_, i) => ({ caminho: `app/electron/pasta${i}/preload.js`, adicionadas: [] }));
  assert.match(faltasDaPr({ corpo: corpoBaixa, arquivos: seis })[0], /; … e mais 2$/);
});

test('prova: a seção pede a frase sozinha, o head inteiro e uma explicação de ao menos 40 caracteres', () => {
  const falha = (trecho, esperado) => assert.deepEqual(faltasDaPr({ corpo: corpoAlta(trecho) }), [esperado]);
  falha('', 'atenção ALTA: o corpo não tem a seção "Prova real"');
  falha('## Prova real\nHead: ' + HEAD + '\nRodei o app e funcionou muito bem no computador de teste.', 'atenção ALTA: a seção "Prova real" não tem a linha PROVADO 100% REAL (a frase sozinha na linha)');
  falha('## Prova real\nPROVADO 100% REAL\nRodei o app e funcionou muito bem no computador de teste.', 'atenção ALTA: a seção "Prova real" não tem a linha "Head:" com o SHA do head');
  falha(prova(OUTRO), `atenção ALTA: a seção "Prova real" é do commit ${OUTRO}, que não é o head (o head mudou: o que valia para o commit anterior não vale)`);
  falha(prova(HEAD.slice(0, 9)), 'atenção ALTA: a seção "Prova real" tem o SHA do head abreviado; escreva os 40 caracteres');
  falha(prova(`${HEAD} e mais`), 'atenção ALTA: a seção "Prova real" tem na linha "Head:" mais do que o SHA do head (uma linha por SHA, só os 40 caracteres)');
  falha(`## Prova real\nPROVADO 100% REAL\nHead: ${HEAD}\nHead: ${OUTRO}\n${EXPLICACAO}`, 'atenção ALTA: a seção "Prova real" tem na linha "Head:" mais do que o SHA do head (uma linha por SHA, só os 40 caracteres)');
  falha(prova(HEAD, 'ok'), 'atenção ALTA: a seção "Prova real" não explica o que foi provado no app (escreva ao menos 40 caracteres sobre o que rodou e o que apareceu)');
  assert.equal(conferir({ ...comum, corpo: corpoAlta(prova(HEAD.toUpperCase())) }).ok, true);
  assert.equal(conferir({ ...comum, corpo: corpoAlta(prova(HEAD, 'x'.repeat(40))) }).ok, true);
  assert.equal(conferir({ ...comum, corpo: corpoAlta(prova(HEAD, 'x'.repeat(39))) }).ok, false);
});

test('prova: NÃO COBERTO e BLOQUEADA invalidam, mesmo em bloco de código, e só valem dentro da seção', () => {
  const parcial = (texto, nome) => assert.deepEqual(faltasDaPr({ corpo: corpoAlta(prova(HEAD, texto)) }), [
    `atenção ALTA: a seção "Prova real" diz ${nome}: prova parcial não vale como PROVADO 100% REAL; prove o que falta e escreva a nota sem NÃO COBERTO nem BLOQUEADA`,
  ]);
  parcial('O iPhone ficou NÃO COBERTO nesta rodada de prova no aparelho.', 'NAO COBERTO');
  parcial('o iphone ficou nao-coberto nesta rodada de prova no aparelho.', 'NAO COBERTO');
  parcial('```\nbloqueada\n```\nRodei o app e funcionou muito bem no computador de teste.', 'BLOQUEADA');
  parcial('> BLOQUEADA-iPhone\nRodei o app e funcionou muito bem no computador de teste.', 'BLOQUEADA');
  assert.equal(conferir({ ...comum, corpo: corpoAlta(`${prova(HEAD)}\n## Outra seção\nBLOQUEADA e NÃO COBERTO\n`) }).ok, true);
  assert.equal(conferir({ ...comum, corpo: corpoAlta(`${prova(HEAD)}\n### Detalhe\nBLOQUEADA\n`) }).ok, false);
});

test('prova: o título da seção vale em qualquer nível e caixa, e a seção vai até o título de nível igual ou menor', () => {
  const secao = titulo => `${titulo}\n\nPROVADO 100% REAL\nHead: ${HEAD}\n\n${EXPLICACAO}\n`;
  for (const titulo of ['## Prova real', '# prova REAL', '### **Prova real**', '## Prova real ##', '   ## Prova Real']) {
    assert.equal(conferir({ ...comum, corpo: corpoAlta(secao(titulo)) }).ok, true, titulo);
  }
  assert.equal(conferir({ ...comum, corpo: corpoAlta(secao('Prova real')) }).ok, false);
  assert.equal(conferir({ ...comum, corpo: corpoAlta(`## Prova real\nPROVADO 100% REAL\nHead: ${HEAD}\n### Detalhe\n${EXPLICACAO}\n`) }).ok, true);
  assert.equal(conferir({ ...comum, corpo: corpoAlta(`## Prova real\nPROVADO 100% REAL\n## Fim\nHead: ${HEAD}\n${EXPLICACAO}\n`) }).ok, false);
});

test('faltaDaProva: devolve a falta ou null, com o head que se passa', () => {
  assert.equal(faltaDaProva(prova(HEAD), HEAD), null);
  assert.equal(faltaDaProva('x', HEAD), 'atenção ALTA: o corpo não tem a seção "Prova real"');
  assert.equal(faltaDaProva(prova(HEAD), OUTRO), `atenção ALTA: a seção "Prova real" é do commit ${HEAD}, que não é o head (o head mudou: o que valia para o commit anterior não vale)`);
  assert.equal(faltaDaProva(undefined, HEAD), 'atenção ALTA: o corpo não tem a seção "Prova real"');
});

test('revisão: sem registro, de outro head, abreviada e a mais recente é a que a mensagem cita', () => {
  const falta = registros => faltasDaPr({ corpo: corpoBaixa, registros });
  assert.deepEqual(falta([]), ['nenhum comentário ou revisão da PR é o registro de revisão independente (linhas "Veredito: CLEAN", "Head: <SHA>", "Autor:", "Revisor:" e "Risco:")']);
  assert.deepEqual(falta(['texto sem veredito', 'Head: ' + HEAD]), ['nenhum comentário ou revisão da PR é o registro de revisão independente (linhas "Veredito: CLEAN", "Head: <SHA>", "Autor:", "Revisor:" e "Risco:")']);
  assert.deepEqual(falta([revisao(OUTRO)]), [`o registro de revisão mais recente é do commit ${OUTRO}, que não é o head (o head mudou: o que valia para o commit anterior não vale)`]);
  assert.deepEqual(falta([revisao(HEAD.slice(0, 10))]), ['o registro de revisão mais recente tem o SHA do head abreviado; escreva os 40 caracteres']);
  assert.deepEqual(falta([revisao(`${HEAD} ${OUTRO}`)]), ['o registro de revisão mais recente tem na linha "Head:" mais do que o SHA do head (uma linha por SHA, só os 40 caracteres)']);
  assert.deepEqual(falta([`Veredito: CLEAN\nAutor: a\nRevisor: b\nRisco: BAIXA`]), ['o registro de revisão mais recente não tem a linha "Head:" com o SHA do head']);
  assert.equal(conferir({ ...comum, corpo: corpoBaixa, registros: [revisao(HEAD), revisao(OUTRO)] }).ok, true);
});

test('revisão: veredito diferente de CLEAN no head não se desfaz com outro registro', () => {
  const ruim = 'um registro de revisão deste head tem o veredito MUDANÇAS, não CLEAN; um veredito que não é CLEAN no head não se desfaz com outro comentário: corrija e faça um commit novo';
  assert.deepEqual(faltasDaPr({ corpo: corpoBaixa, registros: [revisao(HEAD, { veredito: 'MUDANÇAS' })] }), [ruim]);
  assert.deepEqual(faltasDaPr({ corpo: corpoBaixa, registros: [revisao(HEAD, { veredito: 'MUDANÇAS' }), revisao(HEAD)] }), [ruim]);
  assert.deepEqual(faltasDaPr({ corpo: corpoBaixa, registros: [revisao(HEAD), revisao(HEAD, { veredito: 'MUDANÇAS' })] }), [ruim]);
  assert.equal(conferir({ ...comum, corpo: corpoBaixa, registros: [revisao(OUTRO, { veredito: 'MUDANÇAS' }), revisao(HEAD)] }).ok, true);
});

test('revisão: autor e revisor diferentes, o revisor não abriu a PR, o risco é um dos três', () => {
  const falta = (registro, autor) => faltasDaPr({ corpo: corpoBaixa, registros: [registro], autor });
  assert.deepEqual(falta(`Veredito: CLEAN\nHead: ${HEAD}\nRevisor: b\nRisco: BAIXA`), ['o registro de revisão não diz quem é o autor e quem é o revisor (linhas "Autor:" e "Revisor:")']);
  assert.deepEqual(falta(`Veredito: CLEAN\nHead: ${HEAD}\nAutor: a\nRisco: BAIXA`), ['o registro de revisão não diz quem é o autor e quem é o revisor (linhas "Autor:" e "Revisor:")']);
  assert.deepEqual(falta(revisao(HEAD, { revisor: 'Agente-A' })), ['o revisor do registro é o próprio autor (agente-a)']);
  assert.deepEqual(falta(revisao(HEAD), 'AGENTE-B'), ['o revisor do registro (agente-b) é quem abriu a PR']);
  assert.equal(conferir({ ...comum, corpo: corpoBaixa, autor: 'agente-a' }).ok, true);
  assert.equal(conferir({ ...comum, corpo: corpoBaixa, autor: '' }).ok, true);
  const semRisco = ['o registro de revisão não diz o risco que o revisor viu (uma linha "Risco: BAIXA", "Risco: MÉDIA", "Risco: ALTA")'];
  assert.deepEqual(falta(`Veredito: CLEAN\nHead: ${HEAD}\nAutor: a\nRevisor: b`), semRisco);
  assert.deepEqual(falta(revisao(HEAD, { risco: 'enorme' })), semRisco);
  assert.deepEqual(falta(`${revisao(HEAD)}Risco: ALTA\n`), [...semRisco, 'atenção ALTA (o revisor disse Risco: ALTA, o corpo diz BAIXA): o corpo não tem a seção "Prova real"']);
  assert.equal(conferir({ ...comum, corpo: corpoAlta(prova(HEAD)), registros: [revisao(HEAD, { risco: 'média' })] }).ok, true);
});

test('revisão: um registro bom entre registros ruins basta; sem nenhum bom vale a falta do último', () => {
  assert.equal(conferir({ ...comum, corpo: corpoBaixa, registros: [revisao(HEAD, { revisor: 'agente-a' }), revisao(HEAD)] }).ok, true);
  assert.deepEqual(faltasDaPr({ corpo: corpoBaixa, registros: [revisao(HEAD, { revisor: 'agente-a' }), revisao(HEAD, { risco: 'xx' })] }), [
    'o registro de revisão não diz o risco que o revisor viu (uma linha "Risco: BAIXA", "Risco: MÉDIA", "Risco: ALTA")',
  ]);
});

test('revisão: registro em citação, em bloco de código ou em comentário de HTML não conta', () => {
  const nenhum = ['nenhum comentário ou revisão da PR é o registro de revisão independente (linhas "Veredito: CLEAN", "Head: <SHA>", "Autor:", "Revisor:" e "Risco:")'];
  const escondidos = [`> ${revisao(HEAD).split('\n').join('\n> ')}`, `\`\`\`\n${revisao(HEAD)}\`\`\`\n`, `<!--\n${revisao(HEAD)}-->`];
  for (const registro of escondidos) assert.deepEqual(faltasDaPr({ corpo: corpoBaixa, registros: [registro] }), nenhum);
  assert.equal(conferir({ ...comum, corpo: corpoBaixa, registros: [`Registro de revisão independente\n\n**Veredito:** CLEAN\n- Head: ${HEAD}\n- Autor: a\n- Revisor: b\n- Risco: BAIXA\n`] }).ok, true);
});

test('faltaDaRevisao: devolve a falta ou null, com o autor da PR', () => {
  assert.equal(faltaDaRevisao([revisao(HEAD)], HEAD, 'outro'), null);
  assert.equal(faltaDaRevisao([revisao(HEAD)], HEAD), null);
  assert.equal(faltaDaRevisao([revisao(HEAD)], HEAD, 'agente-b'), 'o revisor do registro (agente-b) é quem abriu a PR');
  assert.equal(faltaDaRevisao([], HEAD), 'nenhum comentário ou revisão da PR é o registro de revisão independente (linhas "Veredito: CLEAN", "Head: <SHA>", "Autor:", "Revisor:" e "Risco:")');
});

test('tituloDe: nível e texto do título, sem o fecho, e nada para o que não é título', () => {
  assert.deepEqual(tituloDe('# Título'), { nivel: 1, texto: 'Título' });
  assert.deepEqual(tituloDe('## Prova real ##'), { nivel: 2, texto: 'Prova real' });
  assert.deepEqual(tituloDe('###### x #'), { nivel: 6, texto: 'x' });
  assert.deepEqual(tituloDe('   ## y'), { nivel: 2, texto: 'y' });
  assert.deepEqual(tituloDe('## y\r'), { nivel: 2, texto: 'y' });
  assert.deepEqual(tituloDe('## a # b'), { nivel: 2, texto: 'a # b' });
  assert.deepEqual(tituloDe('## a#'), { nivel: 2, texto: 'a#' });
  assert.deepEqual(tituloDe('## x ###  '), { nivel: 2, texto: 'x' });
  assert.deepEqual(tituloDe('## '), { nivel: 2, texto: '' });
  for (const linha of ['####### x', '##', 'texto', '#semespaco', '    ## recuado']) assert.equal(tituloDe(linha), null, linha);
});

test('marcaDeProvaParcial: a marca em maiúsculas e sem acento, ou nada', () => {
  assert.equal(marcaDeProvaParcial('NÃO COBERTO'), 'NAO COBERTO');
  assert.equal(marcaDeProvaParcial('nao-coberto'), 'NAO COBERTO');
  assert.equal(marcaDeProvaParcial('não  cobertas'), 'NAO COBERTAS');
  assert.equal(marcaDeProvaParcial('**bloqueado**'), 'BLOQUEADO');
  assert.equal(marcaDeProvaParcial('BLOQUEADA-iPhone'), 'BLOQUEADA');
  for (const texto of ['cobertos', 'tudo certo', 'desbloqueado', undefined, null, '']) assert.equal(marcaDeProvaParcial(texto), null, String(texto));
});

test('atencaoValida: a atenção com a escrita certa, ou nada', () => {
  assert.deepEqual(ATENCOES, ['BAIXA', 'MÉDIA', 'ALTA']);
  assert.equal(atencaoValida('alta'), 'ALTA');
  assert.equal(atencaoValida('Média'), 'MÉDIA');
  assert.equal(atencaoValida('MEDIA'), 'MÉDIA');
  assert.equal(atencaoValida('baixa '), 'BAIXA');
  assert.equal(atencaoValida('x'), undefined);
  assert.equal(atencaoValida(''), undefined);
});

test('constantes: a frase, a marca de bloqueio, o rótulo e o nome da seção', () => {
  assert.equal(FRASE, 'PROVADO 100% REAL');
  assert.equal(BLOQUEADA, 'BLOQUEADA-iPhone');
  assert.equal(ROTULO_DE_RISCO_ALTO, 'risco:alto');
  assert.equal(SECAO_DA_PROVA, 'Prova real');
});

test('linhasQueValem: tira comentário de HTML, bloco de código e citação, e limpa a marcação', () => {
  const markdown = '# T\n<!-- oculto\nlinha -->\ntexto **negrito**\n```\ncodigo\n```\n> citação\n- item.\n~~~\nx\n~~~~\ny\n~~~~\nfim\n';
  assert.deepEqual(linhasQueValem(markdown), [
    { texto: 'T', nivel: 1 }, { texto: '', nivel: 0 }, { texto: 'texto negrito', nivel: 0 }, { texto: 'item', nivel: 0 }, { texto: 'y', nivel: 0 },
  ]);
  assert.deepEqual(linhasQueValem('<!-- sem fim\nx'), [{ texto: '', nivel: 0 }]);
  assert.deepEqual(linhasQueValem(null), [{ texto: '', nivel: 0 }]);
  assert.deepEqual(linhasQueValem('a\r\n## B ##\r\n  - Atenção: *ALTA*!\r\n'), [
    { texto: 'a', nivel: 0 }, { texto: 'B', nivel: 2 }, { texto: 'Atenção: ALTA', nivel: 0 }, { texto: '', nivel: 0 },
  ]);
  assert.deepEqual(linhasQueValem('```js\nx\n~~~\n```\ny\n'), [{ texto: 'y', nivel: 0 }, { texto: '', nivel: 0 }]);
  assert.deepEqual(linhasQueValem('````\nx\n```\n````\ny\n'), [{ texto: 'y', nivel: 0 }, { texto: '', nivel: 0 }]);
});

function githubDeMentira(rotas) {
  const chamadas = [];
  const original = global.fetch;
  global.fetch = async (url, opcoes) => {
    chamadas.push({ url, cabecalhos: opcoes.headers });
    const endereco = new URL(url);
    const rota = endereco.pathname.replace('/repos/dono/repo/', '');
    const resposta = rotas[rota];
    if (resposta === undefined) return { ok: false, status: 404 };
    return { ok: true, json: async () => (typeof resposta === 'function' ? resposta(Number(endereco.searchParams.get('page') || 1)) : resposta) };
  };
  return { chamadas, restaurar: () => { global.fetch = original; } };
}

const PR_LIDA = { body: 'corpo da PR', labels: [{ name: 'risco:alto' }, { name: 'x' }], head: { sha: HEAD }, base: { ref: 'main' }, number: 7, user: { login: 'dono' } };
const AMBIENTE = { GITHUB_REPOSITORY: 'dono/repo', PR: '7', GITHUB_API_URL: 'http://127.0.0.1:1', GITHUB_TOKEN: 'token-de-teste' };

async function comPastaSemGit(corpo) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'registro-sem-git-'));
  try {
    return await corpo(pasta);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

test('lerDoGitHub: junta corpo, rótulos, autor, head, registros por data e arquivos com as linhas acrescentadas', async () => {
  const github = githubDeMentira({
    'pulls/7': PR_LIDA,
    'issues/7/comments': [
      { body: 'segundo', author_association: 'OWNER', created_at: '2026-01-02T00:00:00Z' },
      { body: 'de fora', author_association: 'NONE', created_at: '2026-01-01T00:00:00Z' },
      { body: 'de contribuidor', author_association: 'CONTRIBUTOR', created_at: '2026-01-01T00:00:00Z' },
      { body: 'quarto', author_association: 'MEMBER', created_at: '2026-02-01T00:00:00Z' },
    ],
    'pulls/7/reviews': [
      { body: null, author_association: 'COLLABORATOR', submitted_at: '2025-12-31T00:00:00Z' },
      { body: 'terceiro', author_association: 'OWNER', submitted_at: '2026-01-03T00:00:00Z', created_at: '2026-01-01T00:00:00Z' },
    ],
    'pulls/7/files': [
      { filename: 'a.js', patch: '@@ -1 +1 @@\n+++ b\n+um\n-dois\n+++tres\n+', changes: 3 },
      { filename: 'grande.bin', changes: 5 },
      { filename: 'vazio.txt', changes: 0 },
      { filename: 'novo.js', previous_filename: 'velho.js', patch: '+x', changes: 1 },
    ],
  });
  try {
    const lido = await comPastaSemGit(pasta => lerDoGitHub({ ...AMBIENTE, GITHUB_WORKSPACE: pasta }));
    assert.deepEqual(lido, {
      corpo: 'corpo da PR',
      rotulos: ['risco:alto', 'x'],
      registros: ['', 'segundo', 'terceiro', 'quarto'],
      head: HEAD,
      arquivos: [
        { caminho: 'a.js', adicionadas: ['um', ''] },
        { caminho: 'grande.bin', adicionadas: null },
        { caminho: 'vazio.txt', adicionadas: [] },
        { caminho: 'novo.js', adicionadas: ['x'] },
        { caminho: 'velho.js', adicionadas: [] },
      ],
      autor: 'dono',
      semComentario: new Set(),
    });
    assert.deepEqual(github.chamadas.map(chamada => chamada.url), [
      'http://127.0.0.1:1/repos/dono/repo/pulls/7',
      'http://127.0.0.1:1/repos/dono/repo/issues/7/comments?per_page=100&page=1',
      'http://127.0.0.1:1/repos/dono/repo/pulls/7/reviews?per_page=100&page=1',
      'http://127.0.0.1:1/repos/dono/repo/pulls/7/files?per_page=100&page=1',
    ]);
    assert.deepEqual(github.chamadas[0].cabecalhos, { accept: 'application/vnd.github+json', authorization: 'Bearer token-de-teste' });
  } finally {
    github.restaurar();
  }
});

test('lerDoGitHub: lê todas as páginas de cem, sem token não manda autorização e sem usuário o autor é indefinido', async () => {
  const cem = Array.from({ length: 100 }, (_, i) => ({ body: `c${String(i).padStart(3, '0')}`, author_association: 'OWNER', created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z` }));
  const github = githubDeMentira({
    'pulls/7': { ...PR_LIDA, user: null, labels: [] },
    'issues/7/comments': pagina => (pagina === 1 ? cem : [{ body: 'ultimo', author_association: 'OWNER', created_at: '2027-01-01T00:00:00Z' }]),
    'pulls/7/reviews': [],
    'pulls/7/files': [],
  });
  try {
    const lido = await comPastaSemGit(pasta => lerDoGitHub({ GITHUB_REPOSITORY: 'dono/repo', PR: '7', GITHUB_WORKSPACE: pasta }));
    assert.equal(lido.registros.length, 101);
    assert.equal(lido.registros[100], 'ultimo');
    assert.equal(lido.autor, null);
    assert.deepEqual(github.chamadas[0], { url: 'https://api.github.com/repos/dono/repo/pulls/7', cabecalhos: { accept: 'application/vnd.github+json' } });
    assert.ok(github.chamadas.some(chamada => chamada.url.endsWith('/issues/7/comments?per_page=100&page=2')));
  } finally {
    github.restaurar();
  }
});

test('lerDoGitHub: resposta que não é ok vira erro com o status e o caminho', async () => {
  const github = githubDeMentira({});
  try {
    await assert.rejects(lerDoGitHub(AMBIENTE), { message: 'o GitHub respondeu 404 a pulls/7' });
  } finally {
    github.restaurar();
  }
});

test('arquivosSoComComentarioRemovido: os arquivos do commit que só perdem comentário; erro vira conjunto vazio', () => {
  const repo = criar({ 'app/electron/preload.js': "// canal\nipcMain.handle('canal', () => 1);\n", 'app/outro.js': 'const um = 1;\n' });
  try {
    repo.escrever({ 'app/electron/preload.js': "ipcMain.handle('canal', () => 1);\n", 'app/outro.js': 'const um = 1;\nconst dois = 2;\n' });
    repo.guardar('tira o comentário e mexe no outro');
    repo.git('update-ref', 'refs/remotes/origin/main', 'main');
    const head = repo.git('rev-parse', 'HEAD');
    const pr = { number: 7, head: { sha: head }, base: { ref: 'main' } };
    assert.deepEqual([...arquivosSoComComentarioRemovido({ GITHUB_WORKSPACE: repo.raiz }, pr)], ['app/electron/preload.js']);
    assert.deepEqual([...arquivosSoComComentarioRemovido({ GITHUB_WORKSPACE: repo.raiz }, { ...pr, base: { ref: 'nao-existe' } })], []);
  } finally {
    repo.limpar();
  }
});

async function executarComGitHub(rotas, ambiente) {
  const servidor = http.createServer((pedido, resposta) => {
    const rota = new URL(pedido.url, 'http://x').pathname.replace('/repos/dono/repo/', '');
    const conteudo = rotas[rota];
    resposta.statusCode = conteudo === undefined ? 404 : 200;
    resposta.end(JSON.stringify(conteudo === undefined ? {} : conteudo));
  });
  await new Promise(pronto => servidor.listen(0, '127.0.0.1', pronto));
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'registro-main-'));
  try {
    const url = `http://127.0.0.1:${servidor.address().port}`;
    const filho = spawn(process.execPath, [REGISTRO_DA_PR], { env: { PATH: process.env.PATH, GITHUB_WORKSPACE: pasta, GITHUB_API_URL: url, ...ambiente } });
    let saida = '';
    filho.stdout.on('data', pedaco => { saida += pedaco; });
    filho.stderr.on('data', pedaco => { saida += pedaco; });
    const codigo = await new Promise(pronto => filho.on('close', pronto));
    return { codigo, linhas: saida.split('\n').filter(Boolean) };
  } finally {
    servidor.close();
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

const ROTAS_DA_PR = { 'pulls/7': PR_LIDA, 'issues/7/comments': [], 'pulls/7/reviews': [], 'pulls/7/files': [] };
const USO = 'uso: GITHUB_TOKEN=… GITHUB_REPOSITORY=<dono/repo> PR=<número> HEAD=<SHA inteiro do head> node scripts/regras/registro-da-pr.js';

test('registro-da-pr.js: sem repositório, sem número da PR ou com head que não é o SHA inteiro, mostra o uso e sai com 2', async () => {
  const entradas = [{}, { GITHUB_REPOSITORY: 'dono/repo', HEAD }, { GITHUB_REPOSITORY: 'dono/repo', PR: '7x', HEAD }, { GITHUB_REPOSITORY: 'dono/repo', PR: '7', HEAD: HEAD.slice(0, 39) }, { GITHUB_REPOSITORY: 'dono/repo', PR: '7' }];
  for (const entrada of entradas) assert.deepEqual(await executarComGitHub(ROTAS_DA_PR, entrada), { codigo: 2, linhas: [USO] });
});

test('registro-da-pr.js: PR que o GitHub não devolve sai com 2 e o motivo', async () => {
  const resultado = await executarComGitHub({}, { GITHUB_REPOSITORY: 'dono/repo', PR: '7', HEAD });
  assert.deepEqual(resultado, { codigo: 2, linhas: ['✗ Não consegui ler a PR 7 no GitHub: o GitHub respondeu 404 a pulls/7'] });
});

test('registro-da-pr.js: o head que mudou durante a execução sai com 1; o head é lido sem espaço nem maiúscula', async () => {
  const mudou = await executarComGitHub(ROTAS_DA_PR, { GITHUB_REPOSITORY: 'dono/repo', PR: '7', HEAD: OUTRO });
  assert.deepEqual(mudou, { codigo: 1, linhas: [`✗ O head da PR agora é ${HEAD}, não ${OUTRO}: um commit novo chegou durante a execução; rode o check de novo.`] });
  const mesmo = await executarComGitHub(ROTAS_DA_PR, { GITHUB_REPOSITORY: 'dono/repo', PR: '7', HEAD: `  ${HEAD.toUpperCase()}\n` });
  assert.equal(mesmo.linhas[0], `✗ O registro da PR não vale para o head ${HEAD}:`);
});

test('registro-da-pr.js: registro válido sai com 0 e diz o head; inválido sai com 1, e no CI diz como rodar de novo', async () => {
  const valido = { ...ROTAS_DA_PR, 'pulls/7': { ...PR_LIDA, labels: [], body: corpoBaixa }, 'issues/7/comments': [{ body: revisao(HEAD), author_association: 'OWNER', created_at: '2026-01-01T00:00:00Z' }] };
  assert.deepEqual(await executarComGitHub(valido, { GITHUB_REPOSITORY: 'dono/repo', PR: '7', HEAD }), { codigo: 0, linhas: [`registro da PR ok no head ${HEAD}: atenção BAIXA, revisão CLEAN`] });
  const foraDoCi = await executarComGitHub(ROTAS_DA_PR, { GITHUB_REPOSITORY: 'dono/repo', PR: '7', HEAD });
  assert.equal(foraDoCi.codigo, 1);
  assert.equal(foraDoCi.linhas[0], `✗ O registro da PR não vale para o head ${HEAD}:`);
  assert.ok(foraDoCi.linhas.includes('    - o corpo não descreve a mudança (escreva ao menos 40 caracteres sobre o que muda e por quê)'));
  assert.ok(!foraDoCi.linhas.some(linha => linha.includes('gh run rerun')));
  const noCi = await executarComGitHub(ROTAS_DA_PR, { GITHUB_REPOSITORY: 'dono/repo', PR: '7', HEAD, GITHUB_RUN_ID: '99' });
  assert.equal(noCi.linhas[noCi.linhas.length - 1], '  Publicou a revisão? Rode de novo: gh run rerun 99 --failed -R dono/repo');
});
