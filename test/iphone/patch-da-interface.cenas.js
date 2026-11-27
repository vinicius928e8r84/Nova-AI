'use strict';

const path = require('path');

const FIXTURES = {
  sequestro: 'bundle-sequestro-de-camera.txt',
};

const trocarNaPosicao = posicao => texto => {
  const letras = Array.from(texto);
  letras[posicao] = '§';
  return letras.join('');
};

const trocarUmaVez = (de, para) => texto => {
  const partes = texto.split(de);
  if (partes.length !== 2) throw new Error(`o trecho da cena aparece ${partes.length - 1} vezes: ${de.slice(0, 60)}`);
  return partes.join(para);
};

const quebras = tabela => tabela.map(([nome, posicao]) => ({ nome, entrada: trocarNaPosicao(posicao) }));

const SEQUESTRO_QUEBRAS = [
  ['sem o trecho da mensagem do módulo instalado', 8769],
  ['sem o trecho do início do Ligar', 9846],
  ['sem o trecho do sucesso do Ligar', 10029],
  ['sem o trecho do Desligar', 10197],
  ['sem o texto da legenda do Android', 51474],
  ['com o prefixo do primeiro cartão trocado', 52596],
  ['com o prefixo do segundo cartão trocado', 54711],
  ['com um parêntese de cartão trocado', 55323],
  ['sem o item 3', 56109],
  ['sem a âncora do item 1', 53154],
  ['sem a âncora do item 2', 55056],
  ['sem a grade de botões do item 3', 56883],
  ['sem o trecho do botão Ligar desabilitado', 56970],
  ['com o prefixo do cartão Como Funciona trocado', 57978],
  ['sem a âncora do Como Funciona', 58140]
];

const PRIMEIRO_CARTAO = 'b.jsxs("div",{className:"bg-white/[0.02] border border-white/8 rounded-2xl p-5 space-y-3",children:[b.jsxs("div",{className:"flex items-center justify-between"';
const FIM_DO_COMO_FUNCIONA = ']})]});return Fl?b.jsx';

const SEM_ORIGEM = caminhos => [path.join(caminhos.scripts, 'nao-existe.txt'), caminhos.saida];

const SEQUESTRO = {
  nome: 'patch_bundle',
  pasta: 'interface/sequestro-de-camera',
  script: 'patch_bundle.py',
  fixture: FIXTURES.sequestro,
  argumentos: caminhos => [caminhos.entrada],
  saidas: caminhos => ({
    instalado: path.join(caminhos.instalado, 'app', 'dist', 'assets', 'index-Dun7lr2S.js'),
    copia: path.join(caminhos.scripts, 'index-Dun7lr2S.patched.js'),
  }),
  cenas: [
    { nome: 'bundle completo' },
    { nome: 'sem o caminho do bundle', argumentos: () => [] },
    { nome: 'com a origem inexistente', argumentos: SEM_ORIGEM },
    { nome: 'com o primeiro cartão no começo de uma lista', entrada: trocarUmaVez(PRIMEIRO_CARTAO, `[${PRIMEIRO_CARTAO}`) },
    { nome: 'com o Como Funciona seguido de outro caractere', entrada: trocarUmaVez(FIM_DO_COMO_FUNCIONA, `;${FIM_DO_COMO_FUNCIONA}`) },
    ...quebras(SEQUESTRO_QUEBRAS),
  ],
};

module.exports = { patches: [SEQUESTRO] };
