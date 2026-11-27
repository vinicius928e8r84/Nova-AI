#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { BLOQUEADA, FRASE, SECAO_DA_PROVA, conferir, faltaDaProva, faltaDaRevisao, lerDoGitHub, marcaDeProvaParcial } = require('./registro-da-pr');
const { ErroDeUso, ambiente, lerArgumentos } = require('./chamada-do-registro');
const { corpoComAProva, secaoDaProva } = require('./secao-da-prova');
const { cliente, execucaoDoCheck, rodarDeNovo, semExecucao } = require('./escrita-na-pr');

const AJUDA = `uso: node scripts/regras/registrar-na-pr.js <comando> --pr <número> [opções]

  conferir   diz o que o check "Registro da PR" diria agora
  revisao    publica o registro da revisão independente como revisão (comentário) da PR e roda o check de novo
               --head <SHA revisado> --autor <quem escreveu> --revisor <quem revisou> --risco baixa|media|alta
               [--veredito CLEAN] [--nota <arquivo>]
  prova      escreve (ou troca) a seção "${SECAO_DA_PROVA}" do corpo, com ${FRASE} e o head
               --head <SHA provado> --cobertura total|parcial --nota <arquivo com o que foi provado no produto de verdade e como>

  --risco      o risco que o revisor viu; o check usa o maior entre ele e a "Atenção:" do corpo, e ALTA exige ${FRASE}
  --cobertura  total: a prova cobriu tudo e a nota não diz NÃO COBERTO nem BLOQUEADA; parcial: escreve ${BLOQUEADA}
               no lugar de ${FRASE}, e o check fica vermelho enquanto a atenção for ALTA

  --head       o SHA inteiro (40 caracteres) do commit revisado ou provado; se não for o head da PR agora, nada é publicado
  --nota       arquivo de Markdown que entra depois das linhas do registro
  --publicar   escreve no GitHub; sem ela é um ensaio
  --repo       <dono/repo> (padrão: $GITHUB_REPOSITORY, senão o remoto origin)

O token vem de $GITHUB_TOKEN, de $GH_TOKEN ou de \`gh auth token\`. Sai com 0 quando o check passaria, 1 quando não
(ou quando recusou publicar) e 2 no erro de uso ou do GitHub. O revisor tem de ser outra pessoa ou outro agente que o autor.`;

const SHA_INTEIRO = /^[0-9a-f]{40}$/;

const registroDaRevisao = ({ veredito, head, autor, revisor, risco }, nota) => [
  'Registro de revisão independente', '', `Veredito: ${veredito}`, `Head: ${head}`, `Autor: ${autor}`, `Revisor: ${revisor}`, `Risco: ${risco}`,
  ...(nota ? ['', nota.trim()] : []),
].join('\n');

function faltaDoHeadInformado(informado, head, oQue) {
  if (informado === head) return null;
  if (!SHA_INTEIRO.test(informado)) return `--head pede o SHA inteiro, de 40 caracteres (\`git rev-parse HEAD\`); veio "${informado}"`;
  return `${oQue} é do commit ${informado}, e o head da PR agora é ${head}: um commit novo muda o head, e o que valia para o anterior não vale. `
    + `${oQue === 'a revisão' ? 'Revise' : 'Prove'} o head novo (\`git diff ${informado.slice(0, 8)}..${head.slice(0, 8)}\` mostra o que mudou).`;
}

function planejar(opcoes, pr, nota) {
  const { head } = pr;
  if (opcoes.comando === 'conferir') return { depois: conferir({ ...pr, head }) };
  const foraDoHead = faltaDoHeadInformado(opcoes.head, head, opcoes.comando === 'revisao' ? 'a revisão' : 'a prova');
  if (foraDoHead) return { recusa: foraDoHead };
  if (opcoes.comando === 'revisao') {
    const comentario = registroDaRevisao({ ...opcoes, head }, nota);
    const registros = [...pr.registros, comentario];
    const falta = opcoes.veredito === 'CLEAN' && faltaDaRevisao(registros, head, pr.autor);
    if (falta) return { recusa: `o check não aceitaria este registro: ${falta}` };
    return { comentario, depois: conferir({ ...pr, registros, head }) };
  }
  return planejarProva(opcoes, pr, nota);
}

function planejarProva(opcoes, pr, nota) {
  const { head } = pr;
  const parcial = opcoes.cobertura === 'parcial';
  const marca = !parcial && marcaDeProvaParcial(nota);
  if (marca) return { recusa: `a nota diz ${marca}, e isso é cobertura parcial: prove o que falta ou rode com --cobertura parcial (escreve ${BLOQUEADA}, sem ${FRASE})` };
  const secao = secaoDaProva(head, nota, opcoes.cobertura);
  const corpo = corpoComAProva(pr.corpo, secao);
  const falta = !parcial && faltaDaProva(corpo, head);
  if (falta) return { recusa: `o check não aceitaria esta prova: ${falta.replace(/^atenção ALTA: /, '')}` };
  return { corpo, secao, depois: conferir({ ...pr, corpo, head }) };
}

const textoDoPlano = plano => plano.comentario || plano.secao;

function recusar(opcoes, plano) {
  console.log(`✗ Nada foi publicado na PR ${opcoes.pr}: ${plano.recusa}`);
  return 1;
}

function mostrarOPlano(plano, opcoes) {
  const onde = plano.comentario ? 'O comentário' : 'A seção que entra no corpo';
  console.log(`${onde} da PR ${opcoes.pr}${opcoes.publicar ? '' : ' (ensaio: nada foi publicado; repita com --publicar)'}:\n\n${textoDoPlano(plano).replace(/^/gm, '    ')}\n`);
}

async function publicarOPlano(plano, opcoes, alvo) {
  if (plano.comentario) await alvo.pedir('POST', `pulls/${opcoes.pr}/reviews`, { commit_id: alvo.pr.head, event: 'COMMENT', body: plano.comentario });
  else await alvo.pedir('PATCH', `pulls/${opcoes.pr}`, { body: plano.corpo });
  console.log(plano.comentario ? 'Registro publicado como revisão da PR (o evento de revisão já roda o check).' : 'Corpo gravado (a edição do corpo dispara o check).');
}

async function ensaiarOuPublicar(plano, opcoes, alvo) {
  if (!textoDoPlano(plano)) return;
  mostrarOPlano(plano, opcoes);
  if (opcoes.publicar) await publicarOPlano(plano, opcoes, alvo);
}

async function relatarOCheck(plano, opcoes, alvo) {
  console.log(`${textoDoPlano(plano) ? 'Com isso publicado, o check diz:\n' : ''}${plano.depois.mensagem}`);
  if (plano.comentario && opcoes.publicar) console.log(await rodarDeNovo(alvo.pedir, alvo.pr, alvo.qual));
  else if (!plano.corpo && !await execucaoDoCheck(alvo.pedir, alvo.pr.head)) console.log(semExecucao(alvo.qual));
}

async function executarComando(opcoes, env) {
  const nota = opcoes.nota ? fs.readFileSync(opcoes.nota, 'utf8') : '';
  const pedir = cliente(env);
  const pr = await lerDoGitHub(env);
  const plano = planejar(opcoes, pr, nota);
  if (plano.recusa) return recusar(opcoes, plano);
  const alvo = { pedir, pr, qual: { numero: opcoes.pr, repo: env.GITHUB_REPOSITORY } };
  await ensaiarOuPublicar(plano, opcoes, alvo);
  await relatarOCheck(plano, opcoes, alvo);
  return plano.depois.ok ? 0 : 1;
}

function dizerEEncerrar(codigo, texto) {
  console.log(texto);
  return { codigo };
}

function prepararAChamada(argv, env) {
  try {
    const opcoes = lerArgumentos(argv);
    if (opcoes.ajuda) return dizerEEncerrar(0, AJUDA);
    return { opcoes, env: ambiente(env, opcoes) };
  } catch (erro) {
    if (!(erro instanceof ErroDeUso)) throw erro;
    return dizerEEncerrar(2, `${erro.message}\n\n${AJUDA}`);
  }
}

async function main(argv, env) {
  const chamada = prepararAChamada(argv, env);
  if (chamada.codigo !== undefined) return chamada.codigo;
  try {
    return await executarComando(chamada.opcoes, chamada.env);
  } catch (erro) {
    console.log(`✗ ${erro.message}`);
    return 2;
  }
}

if (require.main === module) main(process.argv.slice(2), process.env).then(codigo => { process.exitCode = codigo; });

module.exports = { corpoComAProva, lerArgumentos, planejar, registroDaRevisao, secaoDaProva };
