'use strict';

const { classificar, resumo } = require('./risco');
const { hexasDe, igual, linhasDoCorpo, linhasQueValem, semCaixaNemAcento, tituloDe, trechoDaSecao, valoresDe } = require('./corpo-da-pr');
const { arquivosSoComComentarioRemovido, lerDoGitHub } = require('./leitura-da-pr');

const ATENCOES = ['BAIXA', 'MÉDIA', 'ALTA'];
const ROTULO_DE_RISCO_ALTO = 'risco:alto';
const SECAO_DA_PROVA = 'Prova real';
const FRASE = 'PROVADO 100% REAL';
const BLOQUEADA = 'BLOQUEADA-iPhone';
const MARCAS_DE_PROVA_PARCIAL = /\b(nao[\s-]+cobert[oa]s?|bloquead[oa]s?)\b/;
const VEREDITO_LIMPO = 'CLEAN';
const MODELO = '.github/PULL_REQUEST_TEMPLATE.md';
const PUBLICADOR = 'scripts/regras/registrar-na-pr.js';
const MINIMO_DA_DESCRICAO = 40;
const MINIMO_DA_PROVA = 40;

const SHA_INTEIRO = /^[0-9a-f]{40}$/;
const USO = 'uso: GITHUB_TOKEN=… GITHUB_REPOSITORY=<dono/repo> PR=<número> HEAD=<SHA inteiro do head> node scripts/regras/registro-da-pr.js';

const atencaoValida = valor => ATENCOES.find(atencao => igual(atencao, valor));
const maiorAtencao = (...atencoes) => ATENCOES[Math.max(...atencoes.map(atencao => ATENCOES.indexOf(atencao)))];

function marcaDeProvaParcial(texto) {
  const achada = MARCAS_DE_PROVA_PARCIAL.exec(semCaixaNemAcento(String(texto || '').replace(/[*_`]/g, '')));
  return achada && achada[1].replace(/[\s-]+/g, ' ').toUpperCase();
}

function faltaDoHead(textos, head, oQue) {
  const valores = valoresDe(textos, 'Head').map(valor => valor.toLowerCase());
  if (valores.length && valores.every(valor => valor === head)) return null;
  const hexas = hexasDe(valores);
  if (hexas.includes(head)) return `${oQue} tem na linha "Head:" mais do que o SHA do head (uma linha por SHA, só os 40 caracteres)`;
  const outro = hexas.find(hexa => SHA_INTEIRO.test(hexa));
  if (outro) return `${oQue} é do commit ${outro}, que não é o head (o head mudou: o que valia para o commit anterior não vale)`;
  if (hexas.some(hexa => hexa.length >= 7 && head.startsWith(hexa))) return `${oQue} tem o SHA do head abreviado; escreva os 40 caracteres`;
  return `${oQue} não tem a linha "Head:" com o SHA do head`;
}

function atencaoDe(textos) {
  const ditas = [...new Set(valoresDe(textos, 'Atenção').map(valor => atencaoValida(valor) || valor))];
  if (ditas.length === 1 && ATENCOES.includes(ditas[0])) return { atencao: ditas[0] };
  if (!ditas.length) return { falta: `o corpo não tem a linha de atenção (uma linha "Atenção: ${ATENCOES.join('", "Atenção: ')}")` };
  if (ditas.length > 1) return { falta: `o corpo diz mais de uma atenção (${ditas.join(' e ')})` };
  return { falta: `a atenção "${ditas[0]}" do corpo não é ${ATENCOES.join(' nem ')} (o valor sozinho na linha)` };
}

function faltaDaDescricao(linhas) {
  const texto = linhas.filter(linha => !linha.nivel).map(linha => linha.texto)
    .filter(t => t && !igual(t.split(':')[0], 'Atenção') && !igual(t.split(':')[0], 'Head') && !igual(t, FRASE)).join(' ');
  return texto.replace(/\s+/g, ' ').length >= MINIMO_DA_DESCRICAO ? null
    : `o corpo não descreve a mudança (escreva ao menos ${MINIMO_DA_DESCRICAO} caracteres sobre o que muda e por quê)`;
}

function faltaDoRegistro(textos, autorDaPr) {
  const [autor] = valoresDe(textos, 'Autor');
  const [revisor] = valoresDe(textos, 'Revisor');
  if (!autor || !revisor) return 'o registro de revisão não diz quem é o autor e quem é o revisor (linhas "Autor:" e "Revisor:")';
  if (igual(autor, revisor)) return `o revisor do registro é o próprio autor (${autor})`;
  if (autorDaPr && igual(revisor, autorDaPr)) return `o revisor do registro (${revisor}) é quem abriu a PR`;
  const riscos = valoresDe(textos, 'Risco');
  if (riscos.length !== 1 || !atencaoValida(riscos[0])) return `o registro de revisão não diz o risco que o revisor viu (uma linha "Risco: ${ATENCOES.join('", "Risco: ')}")`;
  return null;
}

const comVeredito = registros => registros.map(linhasQueValem).map(linhas => linhas.map(linha => linha.texto)).filter(textos => valoresDe(textos, 'Veredito').length);
const doHeadDe = (todos, head) => todos.filter(textos => !faltaDoHead(textos, head));

function riscoDoRevisor(registros, head) {
  const riscos = doHeadDe(comVeredito(registros), head).flatMap(textos => valoresDe(textos, 'Risco')).map(atencaoValida).filter(Boolean);
  return riscos.length ? maiorAtencao(...riscos) : null;
}

function faltaDaRevisao(registros, head, autorDaPr) {
  const todos = comVeredito(registros);
  const doHead = doHeadDe(todos, head);
  if (!doHead.length) {
    return todos.length ? faltaDoHead(todos[todos.length - 1], head, 'o registro de revisão mais recente')
      : 'nenhum comentário ou revisão da PR é o registro de revisão independente (linhas "Veredito: CLEAN", "Head: <SHA>", "Autor:", "Revisor:" e "Risco:")';
  }
  const citaOHead = textos => hexasDe(valoresDe(textos, 'Head')).includes(head);
  const reprovado = todos.filter(citaOHead).map(textos => valoresDe(textos, 'Veredito')).flat().find(veredito => veredito !== VEREDITO_LIMPO);
  if (reprovado) return `um registro de revisão deste head tem o veredito ${reprovado}, não ${VEREDITO_LIMPO}; um veredito que não é ${VEREDITO_LIMPO} no head não se desfaz com outro comentário: corrija e faça um commit novo`;
  const faltas = doHead.map(textos => faltaDoRegistro(textos, autorDaPr));
  return faltas.includes(null) ? null : faltas[faltas.length - 1];
}

function faltaDaProva(corpo, head) {
  const trecho = trechoDaSecao(linhasDoCorpo(corpo), SECAO_DA_PROVA);
  if (!trecho) return `atenção ALTA: o corpo não tem a seção "${SECAO_DA_PROVA}"`;
  const parcial = marcaDeProvaParcial(trecho.map(linha => linha.crua).join('\n'));
  const prova = trecho.filter(linha => linha.vale).map(linha => linha.texto);
  if (parcial) return `atenção ALTA: a seção "${SECAO_DA_PROVA}" diz ${parcial}: prova parcial não vale como ${FRASE}; prove o que falta e escreva a nota sem NÃO COBERTO nem BLOQUEADA`;
  if (!prova.includes(FRASE)) return `atenção ALTA: a seção "${SECAO_DA_PROVA}" não tem a linha ${FRASE} (a frase sozinha na linha)`;
  const semHead = faltaDoHead(prova, head, `a seção "${SECAO_DA_PROVA}"`);
  if (semHead) return `atenção ALTA: ${semHead}`;
  const explicacao = prova.filter(texto => texto && !igual(texto, FRASE) && !igual(texto.split(':')[0], 'Head')).join(' ');
  return explicacao.length >= MINIMO_DA_PROVA ? null
    : `atenção ALTA: a seção "${SECAO_DA_PROVA}" não explica o que foi provado no app (escreva ao menos ${MINIMO_DA_PROVA} caracteres sobre o que rodou e o que apareceu)`;
}

function atencaoDaPr(textos, { rotulos, registros, head, arquivos, semComentario }) {
  const { atencao: doCorpo, falta } = atencaoDe(textos);
  const doRevisor = riscoDoRevisor(registros, head) || doCorpo;
  const risco = classificar(arquivos.filter(arquivo => !semComentario.has(arquivo.caminho)));
  const rotulado = rotulos.some(rotulo => igual(String(rotulo), ROTULO_DE_RISCO_ALTO));
  const atencao = maiorAtencao(doCorpo || doRevisor, doRevisor);
  const subiuPeloRevisor = doRevisor === 'ALTA' && doCorpo !== 'ALTA';
  return { doCorpo, falta, risco, atencao, subiuPeloRevisor, alta: atencao === 'ALTA' || rotulado || risco.alta };
}

function faltaDoCaminhoSensivel({ risco, doCorpo }) {
  if (!risco.alta || !ATENCOES.slice(0, -1).includes(doCorpo)) return null;
  return `a PR mexe em caminho sensível, e isso conta como ALTA, mas o corpo diz ${doCorpo}: ${resumo(risco.motivos, 5).join('; ')}`;
}

function faltaDaProvaDaPr(corpo, head, { alta, doCorpo, subiuPeloRevisor }) {
  const falta = alta && faltaDaProva(corpo, head);
  if (!subiuPeloRevisor) return falta;
  return falta && falta.replace(/^atenção ALTA:/, `atenção ALTA (o revisor disse Risco: ALTA, o corpo diz ${doCorpo || 'nada'}):`);
}

function conferir({ corpo, rotulos = [], registros = [], head, arquivos = [], autor, semComentario = new Set() }) {
  const linhas = linhasQueValem(corpo);
  const quadro = atencaoDaPr(linhas.map(linha => linha.texto), { rotulos, registros, head, arquivos, semComentario });
  const { atencao, alta } = quadro;
  const faltas = [
    faltaDaDescricao(linhas),
    quadro.falta,
    faltaDoCaminhoSensivel(quadro),
    faltaDaRevisao(registros, head, autor),
    faltaDaProvaDaPr(corpo, head, quadro),
  ].filter(Boolean);
  if (!faltas.length) return { ok: true, mensagem: `registro da PR ok no head ${head}: atenção ${atencao}, revisão ${VEREDITO_LIMPO}${alta ? `, ${FRASE}` : ''}` };
  return {
    ok: false,
    mensagem: [
      `✗ O registro da PR não vale para o head ${head}:`,
      ...faltas.map(falta => `    - ${falta}`),
      `  Conserto: o formato de cada parte está em ${MODELO} e no CONTRIBUTING.md. O que está em comentário de HTML, em bloco de código ou em citação não conta; na seção "${SECAO_DA_PROVA}", a parte não coberta ou bloqueada conta também no código e na citação.`,
      `  Registrar a revisão e a prova com o head lido do GitHub: node ${PUBLICADOR} --help`,
    ].join('\n'),
  };
}

const temRepositorioEPr = env => Boolean(env.GITHUB_REPOSITORY) && /^\d+$/.test(env.PR || '');
const entradaValida = (env, head) => temRepositorioEPr(env) && SHA_INTEIRO.test(head);

function encerrarCom(codigo, texto) {
  console.log(texto);
  return codigo;
}

async function lerOuMotivo(env) {
  try {
    return { lido: await lerDoGitHub(env) };
  } catch (erro) {
    return { motivo: erro.message };
  }
}

function responder({ ok, mensagem }, env) {
  console.log(mensagem);
  if (!ok && env.GITHUB_RUN_ID) console.log(`  Publicou a revisão? Rode de novo: gh run rerun ${env.GITHUB_RUN_ID} --failed -R ${env.GITHUB_REPOSITORY}`);
  return ok ? 0 : 1;
}

async function main(env) {
  const head = String(env.HEAD || '').trim().toLowerCase();
  if (!entradaValida(env, head)) return encerrarCom(2, USO);
  const { lido, motivo } = await lerOuMotivo(env);
  if (!lido) return encerrarCom(2, `✗ Não consegui ler a PR ${env.PR} no GitHub: ${motivo}`);
  if (lido.head !== head) return encerrarCom(1, `✗ O head da PR agora é ${lido.head}, não ${head}: um commit novo chegou durante a execução; rode o check de novo.`);
  return responder(conferir({ ...lido, head }), env);
}

if (require.main === module) main(process.env).then(codigo => { process.exitCode = codigo; });

module.exports = {
  ATENCOES, BLOQUEADA, FRASE, ROTULO_DE_RISCO_ALTO, SECAO_DA_PROVA,
  arquivosSoComComentarioRemovido, atencaoValida, conferir, faltaDaProva, faltaDaRevisao, lerDoGitHub, linhasQueValem, marcaDeProvaParcial, tituloDe,
};
