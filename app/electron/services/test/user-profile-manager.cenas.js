'use strict';
const { AGORA, chamar } = require('./user-profile-manager.palco');

const COFRE_INSTALADO = '/instalado/Nova/Nova_Vault/MyActivity.json';
const COFRE_DO_APP = '<app>/Nova_Vault/MyActivity.json';
const CONTEXTO = '/dados/userData/nova_user_context.json';

const ATIVIDADES = JSON.stringify([
  { title: 'Pesquisou receitas', safeHtmlItem: [{ html: '<b>bolo&nbsp;de&amp;milho</b>' }, { html: '&quot;oi&quot; &lt;x&gt;' }] },
  { title: '', safeHtmlItem: [] },
  { safeHtmlItem: [{ html: '   ' }] },
  { title: 'Só título' },
  { title: '', safeHtmlItem: [{ html: `<p>${'longo '.repeat(80)}</p>` }] },
]);
const MUITAS_ATIVIDADES = JSON.stringify(Array.from({ length: 130 }, (_, i) => ({ title: `t${i}`, safeHtmlItem: [{ html: 'x'.repeat(600) }] })));
const CONVERSAS = [
  { messages: [{ role: 'user', text: 'oi' }, { role: 'model', text: 'olá' }] },
  {},
  { messages: [{ role: 'assistant', text: 'a' }] },
  { messages: [] }, { messages: [{ role: 'user', text: '4' }] }, { messages: [{ role: 'user', text: '5' }] },
  { messages: [{ role: 'user', text: 'sexta fica de fora' }] },
];
const CONVERSA_ENORME = [{ messages: [{ role: 'user', text: 'z'.repeat(60000) }] }];

const analisar = (chave, conversas) => (perfil, roteiro) => chamar(roteiro, 'analyzeUserGraph', () => perfil.analyzeUserGraph(chave, conversas));
const contexto = (perfil, roteiro) => chamar(roteiro, 'getUserContext', () => perfil.getUserContext());

function cena(nome, montagem, passos) {
  return { nome, ...montagem, passos };
}

const CENAS = [
  cena('sem chave', {}, analisar('', CONVERSAS)),
  cena('sem o pacote do Gemini', { semGemini: true }, analisar('chave', CONVERSAS)),
  cena('desligado depois de três falhas', { globais: { profileAnalysisFailCount: 3 } }, analisar('chave', CONVERSAS)),
  cena('espera quinze minutos entre tentativas', { globais: { lastAnalysisAttemptTime: AGORA - 60000 } }, analisar('chave', CONVERSAS)),
  cena('nada para amostrar', { globais: { lastAnalysisAttemptTime: AGORA - 15 * 60 * 1000 } }, analisar('chave')),
  cena('conversas não são lista', { respostas: ['  perfil  '] }, analisar('chave', 'não é lista')),
  cena('conversas e cofre instalado, primeiro modelo responde', { arquivos: { [COFRE_INSTALADO]: ATIVIDADES, [COFRE_DO_APP]: '[]' }, respostas: ['  perfil do usuário  '] },
    analisar('chave', CONVERSAS)),
  cena('cofre do app quando não há o instalado', { arquivos: { [COFRE_DO_APP]: ATIVIDADES }, respostas: ['perfil'] }, analisar('chave')),
  cena('cofre corrompido segue com as conversas', { arquivos: { [COFRE_INSTALADO]: '{ quebrado' }, respostas: ['perfil'] }, analisar('chave', CONVERSAS)),
  cena('cofre com mais de cem itens e amostra cortada em 50 mil', { arquivos: { [COFRE_INSTALADO]: MUITAS_ATIVIDADES }, respostas: ['perfil'] }, analisar('chave')),
  cena('conversa enorme é cortada em 50 mil', { respostas: ['perfil'] }, analisar('chave', CONVERSA_ENORME)),
  cena('primeiro modelo falha, segundo responde', { respostas: [new Error('500 interno\nmais detalhes'), 'perfil do segundo'] }, analisar('chave', CONVERSAS)),
  cena('primeiro modelo responde vazio, segundo responde', { respostas: ['', 'perfil do segundo'] }, analisar('chave', CONVERSAS)),
  cena('404 para de tentar e conta a falha', { respostas: [new Error('[404] not found')] }, analisar('chave', CONVERSAS)),
  cena('todos falham e a terceira falha desliga', { globais: { profileAnalysisFailCount: 2 }, respostas: [new Error('a'), new Error('b')] }, analisar('chave', CONVERSAS)),
  cena('todos vazios contam uma falha', { globais: { profileAnalysisFailCount: 1 }, respostas: ['', ''] }, analisar('chave', CONVERSAS)),
  cena('contexto gravado', { arquivos: { [CONTEXTO]: '{"context":"o perfil"}' } }, contexto),
  cena('contexto ausente', {}, contexto),
  cena('contexto corrompido', { arquivos: { [CONTEXTO]: 'nada' } }, contexto),
];

module.exports = { CENAS };
