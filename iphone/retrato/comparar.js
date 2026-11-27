'use strict';

const { FORMATO } = require('./retrato');

const ROTULOS_DAS_LISTAS = {
  simbolosImportados: 'símbolo importado',
  simbolosExportados: 'símbolo exportado',
  bibliotecas: 'biblioteca ligada',
  textos: 'texto',
  seletores: 'seletor',
  direitos: 'linha dos direitos',
};

const CAMPOS_DO_CONTROLE_IGNORAVEIS = { versao: ['Version'], bytes: ['Installed-Size'] };
const CAMPOS_DE_BYTES = ['tamanho', 'sha256'];

const uniao = (a, b) => [...new Set([...a, ...b])].sort();

function diferencaDeValor(rotulo, antes, depois) {
  if (antes === depois) return [];
  if (antes === undefined) return [`${rotulo}: acrescentado ${JSON.stringify(depois)}`];
  if (depois === undefined) return [`${rotulo}: removido (era ${JSON.stringify(antes)})`];
  return [`${rotulo}: mudou de ${JSON.stringify(antes)} para ${JSON.stringify(depois)}`];
}

function diferencasDaLista(prefixo, rotulo, antes, depois) {
  const tinha = new Set(antes);
  const tem = new Set(depois);
  return [
    ...depois.filter(item => !tinha.has(item)).map(item => `${prefixo}: ${rotulo} acrescentado: ${JSON.stringify(item)}`),
    ...antes.filter(item => !tem.has(item)).map(item => `${prefixo}: ${rotulo} removido: ${JSON.stringify(item)}`),
  ];
}

function diferencasDoControle(antes, depois, ignorados) {
  return uniao(Object.keys(antes), Object.keys(depois))
    .filter(campo => !ignorados.includes(campo))
    .flatMap(campo => diferencaDeValor(`controle ${campo}`, antes[campo], depois[campo]));
}

function camposDoArquivo(caminho, antes, depois, ignorarBytes) {
  return uniao(Object.keys(antes), Object.keys(depois))
    .filter(campo => !(ignorarBytes && CAMPOS_DE_BYTES.includes(campo)))
    .flatMap(campo => diferencaDeValor(`arquivo ${caminho}: ${campo}`, antes[campo], depois[campo]));
}

function diferencasDosArquivos(antes, depois, ignorarBytesDosBinarios) {
  return uniao(Object.keys(antes.arquivos), Object.keys(depois.arquivos)).flatMap(caminho => {
    const antigo = antes.arquivos[caminho];
    const novo = depois.arquivos[caminho];
    if (!antigo) return [`arquivo acrescentado: ${caminho}`];
    if (!novo) return [`arquivo removido: ${caminho}`];
    const binario = caminho in antes.binarios && caminho in depois.binarios;
    return camposDoArquivo(caminho, antigo, novo, ignorarBytesDosBinarios && binario);
  });
}

function diferencasDoBinario(caminho, antes, depois, ignorarBytes) {
  if (!antes) return [`binário ${caminho}: passou a ser um Mach-O`];
  if (!depois) return [`binário ${caminho}: deixou de ser um Mach-O`];
  const prefixo = `binário ${caminho}`;
  const listas = Object.entries(ROTULOS_DAS_LISTAS).flatMap(([campo, rotulo]) => diferencasDaLista(prefixo, rotulo, antes[campo], depois[campo]));
  const codigo = ignorarBytes ? [] : diferencaDeValor(`${prefixo}: sha256 do código (__TEXT,__text)`, antes.codigo, depois.codigo);
  return [...diferencaDeValor(`${prefixo}: assinado`, antes.assinado, depois.assinado), ...listas, ...codigo];
}

function conferirFormato(retrato, nome) {
  if (!retrato || retrato.formato !== FORMATO) throw new Error(`o retrato "${nome}" não tem o formato ${FORMATO}`);
}

function conferirIgnorados(ignorar) {
  const desconhecidos = ignorar.filter(nome => !(nome in CAMPOS_DO_CONTROLE_IGNORAVEIS));
  if (desconhecidos.length) throw new Error(`não sei ignorar: ${desconhecidos.join(', ')} (use ${Object.keys(CAMPOS_DO_CONTROLE_IGNORAVEIS).join(' ou ')})`);
}

function compararRetratos(antes, depois, ignorar = []) {
  conferirFormato(antes, 'antes');
  conferirFormato(depois, 'depois');
  conferirIgnorados(ignorar);
  const camposIgnorados = ignorar.flatMap(nome => CAMPOS_DO_CONTROLE_IGNORAVEIS[nome]);
  const binarios = uniao(Object.keys(antes.binarios), Object.keys(depois.binarios));
  return [
    ...diferencasDoControle(antes.controle, depois.controle, camposIgnorados),
    ...diferencasDosArquivos(antes, depois, ignorar.includes('bytes')),
    ...binarios.flatMap(caminho => diferencasDoBinario(caminho, antes.binarios[caminho], depois.binarios[caminho], ignorar.includes('bytes'))),
  ];
}

module.exports = { compararRetratos };
