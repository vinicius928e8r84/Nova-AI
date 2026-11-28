'use strict';

const QUINZE_MINUTOS = 15 * 60 * 1000;
const PRIMEIRO = 'gemini-3.8-flash';
const SEGUNDO = 'gemini-4-argon';

const texto = (resposta) => async () => ({ response: Promise.resolve({ text: () => resposta }) });
const falha = (mensagem) => async () => { throw new Error(mensagem); };
const textoQueLanca = (mensagem) => async () => ({ response: Promise.resolve({ text: () => { throw new Error(mensagem); } }) });

const conversa = (numero, mensagens) => ({ messages: mensagens || [{ role: 'user', text: `pergunta ${numero}` }, { role: 'model', text: `resposta ${numero}` }] });
const atividade = (titulo, html) => ({ title: titulo, safeHtmlItem: html === undefined ? undefined : [{ html }] });
const cofreCom = (atividades) => JSON.stringify(atividades);

const analisar = (chave, conversas) => async (perfil) => perfil.analyzeUserGraph(chave, conversas);
const comUmaConversa = [conversa(1)];
const sucesso = { [PRIMEIRO]: texto('  perfil do usuário \n') };

module.exports = [
  { nome: 'sem chave devolve nulo e avisa', roteiro: analisar('', comUmaConversa) },
  { nome: 'sem a biblioteca do Google devolve nulo e avisa', semBiblioteca: true, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'depois de três falhas devolve nulo sem mexer em nada', globais: { profileAnalysisFailCount: 3 }, modelos: sucesso, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'menos de quinze minutos desde a última tentativa devolve nulo', globais: { lastAnalysisAttemptTime: Date.UTC(2026, 10, 28, 12, 0, 0) - QUINZE_MINUTOS + 1 }, modelos: sucesso, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'quinze minutos exatos desde a última tentativa já tentam de novo', globais: { lastAnalysisAttemptTime: Date.UTC(2026, 10, 28, 12, 0, 0) - QUINZE_MINUTOS }, modelos: sucesso, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'sem conversas nem cofre devolve nulo e marca a tentativa', modelos: sucesso, roteiro: analisar('chave', []) },
  { nome: 'conversas que não são lista contam como vazias', modelos: sucesso, roteiro: analisar('chave', 'texto') },
  { nome: 'o primeiro modelo responde: grava o contexto limpo e devolve o texto sem as pontas', modelos: sucesso, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'o primeiro modelo falha e o segundo responde', modelos: { [PRIMEIRO]: falha('falha de rede\nsegunda linha'), [SEGUNDO]: texto('perfil do segundo') }, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'o primeiro modelo vazio passa para o segundo', modelos: { [PRIMEIRO]: texto(''), [SEGUNDO]: texto('perfil do segundo') }, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'um 404 no primeiro modelo para a tentativa e conta uma falha', modelos: { [PRIMEIRO]: falha('[404 Not Found] modelo'), [SEGUNDO]: texto('nunca chega') }, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'um 404 no segundo modelo conta uma falha', modelos: { [PRIMEIRO]: falha('erro qualquer'), [SEGUNDO]: falha('404') }, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'os dois modelos sem texto contam uma falha', modelos: { [PRIMEIRO]: texto(''), [SEGUNDO]: texto('') }, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'a terceira falha desliga a análise da sessão', globais: { profileAnalysisFailCount: 2 }, modelos: { [PRIMEIRO]: texto(''), [SEGUNDO]: texto('') }, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'o texto que lança ao ler a resposta passa para o segundo modelo', modelos: { [PRIMEIRO]: textoQueLanca('sem texto'), [SEGUNDO]: texto('do segundo') }, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'o erro ao gravar o arquivo conta uma falha', escritaFalha: 'disco cheio', modelos: sucesso, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'a falha anterior zerada com sucesso depois de uma falha', globais: { profileAnalysisFailCount: 1, lastAnalysisFailureTime: 77 }, modelos: sucesso, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'só as cinco primeiras conversas entram, com o papel de cada mensagem', modelos: sucesso, roteiro: analisar('chave', [1, 2, 3, 4, 5, 6, 7].map((n) => conversa(n))) },
  { nome: 'conversa sem mensagens entra vazia', modelos: sucesso, roteiro: analisar('chave', [{}, conversa(2, [])]) },
  { nome: 'o cofre ao lado do executável entra com o título e o html limpo', arquivos: { cofre: cofreCom([atividade('Busca A', '<p>Olá&nbsp;<b>mundo</b> &amp; &lt;tag&gt; &quot;oi&quot;</p>\n  <p>fim</p>')]) }, modelos: sucesso, roteiro: analisar('chave', []) },
  { nome: 'o cofre alternativo é usado quando não há o do executável', arquivos: { cofreAlternativo: cofreCom([atividade('Busca B', '<i>x</i>')]) }, modelos: sucesso, roteiro: analisar('chave', []) },
  { nome: 'havendo os dois cofres vale o do executável', arquivos: { cofre: cofreCom([atividade('do exe', '')]), cofreAlternativo: cofreCom([atividade('do alternativo', '')]) }, modelos: sucesso, roteiro: analisar('chave', []) },
  { nome: 'o cofre usa só as cem primeiras atividades e corta o html em 300 caracteres', arquivos: { cofre: cofreCom(Array.from({ length: 120 }, (_, n) => atividade(`T${n}`, n === 0 ? 'a'.repeat(400) : 'b'))) }, modelos: sucesso, roteiro: analisar('chave', []) },
  { nome: 'atividade sem título nem html é ignorada e sem html fica só o título', arquivos: { cofre: cofreCom([{}, atividade('', ''), atividade('só título'), { title: 'sem lista', safeHtmlItem: [{ html: undefined }, { html: '<b>x</b>' }] }]) }, modelos: sucesso, roteiro: analisar('chave', []) },
  { nome: 'o cofre com JSON quebrado avisa e as conversas seguem', arquivos: { cofre: '{quebrado' }, modelos: sucesso, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'uma atividade nula no cofre avisa e guarda só as amostras que já tinham entrado', arquivos: { cofre: '[{"title": "antes"}, null, {"title": "depois"}]' }, modelos: sucesso, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'o cofre que não é lista avisa e as conversas seguem', arquivos: { cofre: '{"a": 1}' }, modelos: sucesso, roteiro: analisar('chave', comUmaConversa) },
  { nome: 'o texto de amostra passa de cinquenta mil caracteres e é cortado', modelos: sucesso, roteiro: analisar('chave', [conversa(1, [{ role: 'user', text: 'z'.repeat(60000) }])]) },
  { nome: 'o contexto gravado é lido sem a análise', arquivos: { contexto: '{"lastUpdated": 1, "context": "perfil antigo"}' }, roteiro: async (perfil) => perfil.getUserContext() },
  { nome: 'sem arquivo de contexto devolve texto vazio', roteiro: async (perfil) => perfil.getUserContext() },
  { nome: 'o contexto quebrado devolve texto vazio', arquivos: { contexto: '{quebrado' }, roteiro: async (perfil) => perfil.getUserContext() },
  { nome: 'o contexto sem o campo devolve indefinido', arquivos: { contexto: '{"lastUpdated": 1}' }, roteiro: async (perfil) => perfil.getUserContext() },
  { nome: 'a análise grava o contexto que o getUserContext lê depois', modelos: sucesso, roteiro: async (perfil) => [await perfil.analyzeUserGraph('chave', comUmaConversa), perfil.getUserContext()] },
];
