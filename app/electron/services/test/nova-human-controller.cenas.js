'use strict';

const RESULTADOS = 'https://www.youtube.com/results?search_query=gatos';
const VIDEO = 'https://www.youtube.com/watch?v=abc123';
const CONSULTA_ESTRANHA = 'café com açúcar & "limão"?';

const baixar = (consulta, tentativa) => (controlador) => controlador.executeHumanDownload(consulta, tentativa);

module.exports = [
  { nome: 'a primeira tentativa digita no YouTube, escolhe o primeiro vídeo e devolve o link', pagina: { urls: [RESULTADOS, RESULTADOS, VIDEO] }, roteiro: baixar('gatos', 1) },
  { nome: 'a primeira tentativa sem a página de resultados clica no ícone de busca', pagina: { urls: ['https://www.youtube.com/', RESULTADOS, VIDEO] }, roteiro: baixar('gatos') },
  { nome: 'a segunda tentativa na página de um vídeo volta e escolhe o segundo resultado', pagina: { urls: [VIDEO, VIDEO] }, roteiro: baixar('gatos', 2) },
  { nome: 'a terceira tentativa fora de um vídeo navega para a busca com a consulta codificada', pagina: { urls: [RESULTADOS, VIDEO] }, roteiro: baixar(CONSULTA_ESTRANHA, 3) },
  { nome: 'a tentativa maior que o número de resultados fica no último', pagina: { urls: [RESULTADOS, VIDEO], resultados: 2 }, roteiro: baixar('gatos', 9) },
  { nome: 'sem resultados a tentativa falha com a mensagem de nenhum vídeo', pagina: { urls: [RESULTADOS], resultados: 0 }, roteiro: baixar('gatos', 1) },
  { nome: 'o link que nunca estabiliza falha depois de vinte leituras', pagina: { urls: [RESULTADOS] }, roteiro: baixar('gatos', 1) },
  { nome: 'o navegador que não abre devolve o erro', navegador: { falhas: { launch: 'sem navegador' } }, roteiro: baixar('gatos', 1) },
  { nome: 'a espera pelos resultados que estoura devolve o erro', navegador: { falhas: { waitForSelector: 'Timeout 20000ms exceeded' } }, roteiro: baixar('gatos', 1) },
  { nome: 'a janela destruída não recebe registro nem aparece', janela: { destruida: true }, pagina: { urls: [RESULTADOS, VIDEO] }, roteiro: baixar('gatos', 1) },
  { nome: 'sem janela o download funciona sem registro', semJanela: true, pagina: { urls: [RESULTADOS, VIDEO] }, roteiro: baixar('gatos', 1) },
  { nome: 'o estado guarda a última consulta e a última tentativa', pagina: { urls: [RESULTADOS, VIDEO] }, roteiro: async (controlador) => [await controlador.executeHumanDownload('um', 1), await controlador.executeHumanDownload('dois', 2)] },
  { nome: 'a limpeza fecha o navegador e registra', roteiro: async (controlador) => controlador.cleanup() },
  { nome: 'a limpeza engole o erro de fechar o navegador', navegador: { falhas: { close: 'já fechado' } }, roteiro: async (controlador) => controlador.cleanup() },
];
