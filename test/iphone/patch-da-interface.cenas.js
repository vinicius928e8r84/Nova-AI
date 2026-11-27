'use strict';

const path = require('path');

const FIXTURES = {
  sequestro: 'bundle-sequestro-de-camera.txt',
  controle: 'bundle-controle-do-celular.txt',
  localizacao: 'bundle-localizacao-pela-proxy.txt',
};

const trocarNaPosicao = posicao => texto => {
  const letras = Array.from(texto);
  letras[posicao] = '§';
  return letras.join('');
};

const acrescentar = sufixo => texto => `${texto}${sufixo}`;

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

const CONTROLE_QUEBRAS = [
  ['sem a marca "function III({onClose:I})"', 12],
  ['sem o trecho de "estados pPlat/pUserPicked"', 999],
  ['sem o trecho de "lista filtrada + ícones"', 10860],
  ['sem a marca "Suíte de Hardware"', 12171],
  ['sem o trecho de "Reparar ADB só no Android"', 12393],
  ['sem a região das abas', 13161],
  ['com 10 usos de e.length nas abas', 14349],
  ['sem o trecho de "título dos dispositivos"', 16158],
  ['sem a marca "DISPOSITIVOS REAIS CONECTADOS"', 16176],
  ['sem o trecho de "estado vazio por plataforma"', 16200],
  ['sem o trecho de "texto vazio (título)"', 16527],
  ['sem o trecho de "texto vazio (dica)"', 16668],
  ['sem o trecho de "cartões de dispositivo filtrados"', 16779],
  ['sem o bloco de conexão', 19431],
  ['com o parêntese do bloco de conexão trocado', 23241],
  ['sem o trecho de "modos de conexão esmaecidos no iOS"', 19584],
  ['sem o trecho de "busca na rede desabilitada no iOS"', 20493],
  ['sem o trecho de "form direto oculto no iOS"', 20838],
  ['sem o trecho de "aviso Exclusivo Android na conexão"', 20853],
  ['sem o trecho de "form pareamento oculto no iOS"', 21891],
  ['sem o trecho de "guia Android oculto no iOS"', 24093],
  ['com o fim do bloco de conexão trocado', 25467],
  ['sem o trecho de "dica dos atalhos no iPhone"', 27120],
  ['sem o trecho de "selo Android nos comandos root"', 27360],
  ['sem o trecho de "reiniciar desabilitado no iOS"', 27471],
  ['sem o trecho de "desligar desabilitado no iOS"', 27855],
  ['sem o trecho de "chips de segurança escondidos no iPhone"', 34695],
  ['sem o trecho de "Marca escondida no iPhone"', 35796],
  ['sem o trecho de "select de modelo do iPhone (7 a 18)"', 36861],
  ['sem o trecho de "campo de proxy do iPhone"', 37200],
  ['sem o trecho de "rótulo do botão no iPhone"', 37689],
  ['sem o trecho de "soft reboot escondido no iPhone"', 37767],
  ['sem o trecho de "verificação Android escondida no iPhone"', 38199],
  ['sem o trecho de "Restaurar vira Remover no iPhone"', 38799],
  ['sem o trecho de "Play Integrity escondido no iPhone"', 39081],
  ['sem o trecho de "IMEI duplo escondido no iPhone"', 39756],
  ['sem o trecho de "painel aplicado: iPhone"', 42006],
  ['sem o trecho de "painel aplicado: fecha lista Android"', 42234],
  ['sem o trecho de "cor do campo Modelo"', 42819],
  ['sem o trecho de "certificação Play Store escondida no iPhone"', 47724],
  ['sem o trecho de "efeitos de plataforma/seleção"', 54669]
];

const LOCALIZACAO_QUEBRAS = [
  ['sem o trecho de "parar restaura idioma/fuso"', 7551],
  ['sem o trecho de "useEffect geo ao abrir"', 11070],
  ['sem o trecho de "helper pGeoApply"', 12759],
  ['sem o trecho de "geo ao salvar proxy"', 13470],
  ['sem o trecho de "geo ao salvar identidade"', 14496],
  ['com um delimitador do botão GPS trocado', 58470],
  ['sem o botão "Fixar GPS Falso"', 58452]
];

const PRIMEIRO_CARTAO = 'b.jsxs("div",{className:"bg-white/[0.02] border border-white/8 rounded-2xl p-5 space-y-3",children:[b.jsxs("div",{className:"flex items-center justify-between"';
const FIM_DO_COMO_FUNCIONA = ']})]});return Fl?b.jsx';

const SEM_ORIGEM = caminhos => [path.join(caminhos.scripts, 'nao-existe.txt'), caminhos.saida];
const NO_MESMO_ARQUIVO = {
  nome: 'com a origem e a saída no mesmo arquivo',
  argumentos: caminhos => [caminhos.entrada, caminhos.entrada],
  saidas: caminhos => ({ entrada: caminhos.entrada }),
};

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

const CONTROLE = {
  nome: 'aplicar',
  pasta: 'interface/controle-do-celular',
  script: 'aplicar.py',
  fixture: FIXTURES.controle,
  argumentos: caminhos => [caminhos.entrada, caminhos.saida],
  saidas: caminhos => ({ saida: caminhos.saida }),
  cenas: [
    { nome: 'bundle completo' },
    { nome: 'bundle completo com a sintaxe conferida a cada passo: para no painel aplicado, onde o texto ainda está pela metade', env: { CHECK_EACH: '1' } },
    { nome: 'sem os dois caminhos', argumentos: () => [] },
    { nome: 'com um caminho só', argumentos: caminhos => [caminhos.entrada] },
    { nome: 'com a origem inexistente', argumentos: SEM_ORIGEM },
    NO_MESMO_ARQUIVO,
    { nome: 'com a sintaxe quebrada no fim', entrada: acrescentar(')') },
    { nome: 'com a sintaxe quebrada no fim, conferindo a cada passo', entrada: acrescentar(')'), env: { CHECK_EACH: '1' } },
    {
      nome: 'sem o trecho de "ação do botão no iPhone"',
      entrada: trocarUmaVez('onClick:el,disabled:uI==="applying"||!D,', 'onClick:el,disabled:uI==="applying"||!D§'),
    },
    ...quebras(CONTROLE_QUEBRAS),
  ],
};

const LOCALIZACAO = {
  nome: 'aplicar-geo',
  pasta: 'interface/controle-do-celular/localizacao-pela-proxy',
  script: 'aplicar-geo.py',
  fixture: FIXTURES.localizacao,
  argumentos: caminhos => [caminhos.entrada, caminhos.saida],
  saidas: caminhos => ({ saida: caminhos.saida }),
  cenas: [
    { nome: 'bundle completo' },
    { nome: 'sem os dois caminhos', argumentos: () => [] },
    { nome: 'com um caminho só', argumentos: caminhos => [caminhos.entrada] },
    { nome: 'com a origem inexistente', argumentos: SEM_ORIGEM },
    NO_MESMO_ARQUIVO,
    { nome: 'com a sintaxe quebrada no fim', entrada: acrescentar(')') },
    ...quebras(LOCALIZACAO_QUEBRAS),
  ],
};

module.exports = { patches: [SEQUESTRO, CONTROLE, LOCALIZACAO] };
