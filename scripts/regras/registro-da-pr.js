'use strict';

const { classificar, resumo } = require('./risco');

const ATENCOES = ['BAIXA', 'MÉDIA', 'ALTA'];
const ROTULO_DE_RISCO_ALTO = 'risco:alto';
const SECAO_DA_PROVA = 'Prova real';
const FRASE = 'PROVADO 100% REAL';
const BLOQUEADA = 'BLOQUEADA-iPhone';
const MARCAS_DE_PROVA_PARCIAL = /\b(nao[\s-]+cobert[oa]s?|bloquead[oa]s?)\b/;
const VEREDITO_LIMPO = 'CLEAN';
const QUEM_REGISTRA = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const MODELO = '.github/PULL_REQUEST_TEMPLATE.md';
const PUBLICADOR = 'scripts/regras/registrar-na-pr.js';
const MINIMO_DA_DESCRICAO = 40;
const MINIMO_DA_PROVA = 40;

const SHA_INTEIRO = /^[0-9a-f]{40}$/;
const TITULO = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const CERCA = /^ {0,3}(`{3,}|~{3,})/;
const CITACAO = /^ {0,3}>/;

function tituloDe(linha) {
  const achado = TITULO.exec(linha.split('\r')[0]);
  if (!achado) return null;
  const texto = achado[2].trimEnd();
  let fim = texto.length;
  while (fim > 0 && texto[fim - 1] === '#') fim--;
  const comFecho = fim < texto.length && (fim === 0 || /\s/.test(texto[fim - 1]));
  return { nivel: achado[1].length, texto: (comFecho ? texto.slice(0, fim) : texto).trim() };
}

function aparar(texto, doInicio, doFim) {
  let inicio = 0;
  let fim = texto.length;
  while (inicio < fim && (/\s/.test(texto[inicio]) || doInicio.includes(texto[inicio]))) inicio++;
  while (fim > inicio && (/\s/.test(texto[fim - 1]) || doFim.includes(texto[fim - 1]))) fim--;
  return texto.slice(inicio, fim);
}

const semMarcacao = texto => aparar(texto.replace(/[*_`]/g, ''), '-', '.!');
const semCaixaNemAcento = texto => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const igual = (a, b) => semCaixaNemAcento(a) === semCaixaNemAcento(b);
const atencaoValida = valor => ATENCOES.find(atencao => igual(atencao, valor));
const maiorAtencao = (...atencoes) => ATENCOES[Math.max(...atencoes.map(atencao => ATENCOES.indexOf(atencao)))];

function marcaDeProvaParcial(texto) {
  const achada = MARCAS_DE_PROVA_PARCIAL.exec(semCaixaNemAcento(String(texto || '').replace(/[*_`]/g, '')));
  return achada && achada[1].replace(/[\s-]+/g, ' ').toUpperCase();
}

const linhasSemComentario = markdown => String(markdown || '').replace(/<!--[^]*?(?:-->|$)/g, '').split(/\r?\n/);
const fechaACerca = (marca, cerca, linha) => marca[0] === cerca[0] && marca.length >= cerca.length && linha.trim() === marca;

function linhaQueVale(crua) {
  const titulo = tituloDe(crua);
  return { texto: semMarcacao(titulo ? titulo.texto : crua), nivel: titulo ? titulo.nivel : 0 };
}

function linhasDoCorpo(markdown) {
  let cerca = null;
  return linhasSemComentario(markdown).map(crua => {
    const abre = CERCA.exec(crua);
    const vale = !abre && !cerca && !CITACAO.test(crua);
    if (abre && !cerca) cerca = abre[1];
    else if (abre && fechaACerca(abre[1], cerca, crua)) cerca = null;
    return { crua, vale, ...(vale ? linhaQueVale(crua) : { nivel: 0 }) };
  });
}

const linhasQueValem = markdown => linhasDoCorpo(markdown).filter(linha => linha.vale).map(({ texto, nivel }) => ({ texto, nivel }));

function trechoDaSecao(linhas, nome) {
  const inicio = linhas.findIndex(linha => linha.nivel && igual(linha.texto, nome));
  if (inicio < 0) return null;
  const resto = linhas.slice(inicio + 1);
  const fim = resto.findIndex(linha => linha.nivel && linha.nivel <= linhas[inicio].nivel);
  return fim < 0 ? resto : resto.slice(0, fim);
}

const valoresDe = (textos, campo) => textos.filter(texto => texto.includes(':'))
  .map(texto => [texto.slice(0, texto.indexOf(':')), texto.slice(texto.indexOf(':') + 1).trim()])
  .filter(([nome, valor]) => valor && igual(nome, campo)).map(([, valor]) => valor);

const hexasDe = textos => textos.join('\n').toLowerCase().match(/[0-9a-f]+/g) || [];

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

function atencaoDaPr(textos, { rotulos, registros, head, arquivos }) {
  const { atencao: doCorpo, falta } = atencaoDe(textos);
  const doRevisor = riscoDoRevisor(registros, head) || doCorpo;
  const risco = classificar(arquivos);
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

function conferir({ corpo, rotulos = [], registros = [], head, arquivos = [], autor }) {
  const linhas = linhasQueValem(corpo);
  const quadro = atencaoDaPr(linhas.map(linha => linha.texto), { rotulos, registros, head, arquivos });
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

function adicionadasDoArquivo(arquivo) {
  if (arquivo.patch === undefined && arquivo.changes > 0) return null;
  return String(arquivo.patch || '').split('\n').filter(linha => linha.startsWith('+') && !linha.startsWith('+++')).map(linha => linha.slice(1));
}

async function lerDoGitHub(env) {
  const ler = async caminho => {
    const resposta = await fetch(`${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/${caminho}`, {
      headers: { accept: 'application/vnd.github+json', ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) },
    });
    if (!resposta.ok) throw new Error(`o GitHub respondeu ${resposta.status} a ${caminho}`);
    return resposta.json();
  };
  const todas = async caminho => {
    const itens = [];
    for (let pagina = 1; ; pagina++) {
      const lote = await ler(`${caminho}?per_page=100&page=${pagina}`);
      itens.push(...lote);
      if (lote.length < 100) return itens;
    }
  };
  const pr = await ler(`pulls/${env.PR}`);
  const registros = [...await todas(`issues/${env.PR}/comments`), ...await todas(`pulls/${env.PR}/reviews`)]
    .filter(registro => QUEM_REGISTRA.includes(registro.author_association))
    .map(registro => ({ corpo: registro.body || '', quando: registro.submitted_at || registro.created_at || '' }))
    .sort((a, b) => a.quando.localeCompare(b.quando)).map(registro => registro.corpo);
  const arquivos = [];
  for (const arquivo of await todas(`pulls/${env.PR}/files`)) {
    arquivos.push({ caminho: arquivo.filename, adicionadas: adicionadasDoArquivo(arquivo) });
    if (arquivo.previous_filename) arquivos.push({ caminho: arquivo.previous_filename, adicionadas: [] });
  }
  return { corpo: pr.body, rotulos: pr.labels.map(rotulo => rotulo.name), registros, head: pr.head.sha, arquivos, autor: pr.user && pr.user.login };
}

async function main(env) {
  const head = String(env.HEAD || '').trim().toLowerCase();
  if (!env.GITHUB_REPOSITORY || !/^\d+$/.test(env.PR || '') || !SHA_INTEIRO.test(head)) {
    console.log('uso: GITHUB_TOKEN=… GITHUB_REPOSITORY=<dono/repo> PR=<número> HEAD=<SHA inteiro do head> node scripts/regras/registro-da-pr.js');
    return 2;
  }
  let lido;
  try {
    lido = await lerDoGitHub(env);
  } catch (erro) {
    console.log(`✗ Não consegui ler a PR ${env.PR} no GitHub: ${erro.message}`);
    return 2;
  }
  if (lido.head !== head) {
    console.log(`✗ O head da PR agora é ${lido.head}, não ${head}: um commit novo chegou durante a execução; rode o check de novo.`);
    return 1;
  }
  const { ok, mensagem } = conferir({ ...lido, head });
  console.log(mensagem);
  if (!ok && env.GITHUB_RUN_ID) console.log(`  Publicou a revisão? Rode de novo: gh run rerun ${env.GITHUB_RUN_ID} --failed -R ${env.GITHUB_REPOSITORY}`);
  return ok ? 0 : 1;
}

if (require.main === module) main(process.env).then(codigo => { process.exitCode = codigo; });

module.exports = {
  ATENCOES, BLOQUEADA, FRASE, ROTULO_DE_RISCO_ALTO, SECAO_DA_PROVA,
  atencaoValida, conferir, faltaDaProva, faltaDaRevisao, lerDoGitHub, linhasQueValem, marcaDeProvaParcial, tituloDe,
};
