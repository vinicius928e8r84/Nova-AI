'use strict';
const { chamar } = require('./nova-human-controller.palco');

const VIDEO = 'https://www.youtube.com/watch?v=abc';
const RESULTADOS = 'https://www.youtube.com/results?search_query=x';

const baixar = (busca, tentativa) => (humano, roteiro) => chamar(roteiro, 'executeHumanDownload', () => humano.executeHumanDownload(busca, tentativa));
const limpar = (humano, roteiro) => chamar(roteiro, 'cleanup', () => humano.cleanup());

function cena(nome, montagem, passos) {
  return { nome, ...montagem, passos };
}

const CENAS = [
  cena('primeira tentativa: Enter abre os resultados e o vídeo carrega na terceira volta',
    { enderecos: [RESULTADOS, 'https://www.youtube.com/results', 'https://www.youtube.com/results', VIDEO], resultados: 3 }, baixar('lofi & chuva')),
  cena('primeira tentativa: Enter não pesquisa e clica na lupa', { enderecos: ['https://www.youtube.com/', VIDEO] }, baixar('música', 1)),
  cena('segunda tentativa a partir do vídeo volta e escolhe o segundo', { enderecos: [VIDEO, VIDEO], resultados: 3 }, baixar('música', 2)),
  cena('terceira tentativa fora do vídeo pesquisa pela URL e fica no único', { enderecos: [RESULTADOS, VIDEO], resultados: 1 }, baixar('a/b c', 3)),
  cena('sem vídeos', { enderecos: [RESULTADOS], resultados: 0 }, baixar('nada')),
  cena('o link nunca estabiliza', { enderecos: [RESULTADOS] }, baixar('lento')),
  cena('navegador não abre', { falhas: { 'browser.launch': 'sem chromium' } }, baixar('x')),
  cena('resultados não aparecem', { enderecos: [RESULTADOS], falhas: { 'page.waitForSelector': 'Timeout 20000ms' } }, baixar('x', 2)),
  cena('janela destruída não recebe log nem foco', { janela: 'destruida', enderecos: [RESULTADOS, VIDEO] }, baixar('x')),
  cena('sem janela', { janela: false, enderecos: [RESULTADOS, VIDEO] }, baixar('x')),
  cena('limpeza fecha o navegador', {}, limpar),
  cena('limpeza engole a falha', { falhas: { 'browser.close': 'já fechado' } }, limpar),
];

module.exports = { CENAS };
