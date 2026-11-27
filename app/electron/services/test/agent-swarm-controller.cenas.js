'use strict';

const { respostaFalsa, respostaDoGemini } = require('./agent-swarm-controller.palco');

const LOGADO = { autenticacao: () => ({ isLoggedIn: true }) };
const PLANO_DE_AGENTE = '{"isAgentTask": true, "reason": "r", "tasks": {"researcher": "gatos", "coder": null}}';

const geminiQueResponde = (texto) => ({ ...LOGADO, responder: () => ({ success: true, text: `  ${texto}  ` }) });
const httpsQueResponde = (status, corpo) => ({ responder: (opcoes, aoResponder) => aoResponder(respostaFalsa(status, JSON.stringify(corpo))) });

function httpsPorModelo(respostas) {
  let chamada = 0;
  return {
    responder: (opcoes, aoResponder, requisicao) => {
      const resposta = respostas[chamada++];
      if (resposta.erroDeRede) return requisicao.emit('error', new Error(resposta.erroDeRede));
      return aoResponder(respostaFalsa(resposta.status, resposta.corpoBruto !== undefined ? resposta.corpoBruto : JSON.stringify(resposta.corpo)));
    },
  };
}

const semNavegadorDoGemini = { autenticacao: () => null };

async function detectar(a, comando) {
  return a.controlador.detectIntent(comando, 'chave-da-api');
}

function chamarExecuteWorkflow(a, comando, delegado, ...filho) {
  return a.controlador.executeWorkflow(comando, 'chave-da-api', delegado, ...filho);
}

async function executarEEsperar(a, comando, delegado, ...filho) {
  const retorno = await chamarExecuteWorkflow(a, comando, delegado, ...filho);
  await a.descarregar();
  return retorno;
}

async function pipelineDoYoutube(a, comando, aoProcesso) {
  const retornos = { inicio: await a.controlador.executeWorkflow(comando, 'k') };
  const processo = a.processo();
  aoProcesso(processo);
  await a.descarregar();
  retornos.ativoDepois = a.controlador.isSwarmActive;
  return retornos;
}

const dadosDoProcesso = (processo, texto) => processo.stdout.emit('data', Buffer.from(texto));

async function baixarDoYoutube(a, consulta, aoNavegador) {
  const pedido = a.controlador.executeVisibleYouTubeDownload(consulta);
  let terminou = false;
  pedido.then(() => { terminou = true; }, () => { terminou = true; });
  if (aoNavegador) aoNavegador();
  await a.ate(() => terminou);
  return pedido;
}

const urlDoYoutube = (id) => `Result: "https://www.youtube.com/watch?v=${id}"`;

function navegadorQueAchaNaTentativa(tentativa, falhaPrimeiro) {
  let chamadas = 0;
  return {
    responder: async (metodo) => {
      if (metodo !== 'executeScript') return undefined;
      chamadas++;
      if (falhaPrimeiro && chamadas === 1) return undefined;
      return chamadas >= tentativa ? urlDoYoutube('abc123') : 'Result: "https://www.youtube.com/"';
    },
  };
}

module.exports = [
  { nome: 'detectIntent usa a sessão do navegador do Gemini e acha o JSON no meio do texto', gemini: geminiQueResponde(`aqui está ${PLANO_DE_AGENTE} fim`), roteiro: (a) => detectar(a, 'search for cats') },
  { nome: 'detectIntent sem palavra de gatilho e sem JSON na resposta devolve plano de não-agente', gemini: geminiQueResponde('sem json'), roteiro: (a) => detectar(a, 'oi tudo bem') },
  { nome: 'detectIntent com a sessão do navegador sem sucesso cai na API com o primeiro modelo', gemini: { ...LOGADO, responder: () => ({ success: false }) }, https: httpsQueResponde(200, respostaDoGemini(`  ${PLANO_DE_AGENTE}  `)), roteiro: (a) => detectar(a, 'download um video') },
  { nome: 'detectIntent com a sessão do navegador sem texto cai na API', gemini: { ...LOGADO, responder: () => ({ success: true, text: '' }) }, https: httpsQueResponde(200, respostaDoGemini(PLANO_DE_AGENTE)), roteiro: (a) => detectar(a, 'script de calculadora') },
  { nome: 'detectIntent com a sessão do navegador que lança erro avisa e usa a API', gemini: { ...LOGADO, responder: () => { throw new Error('sessão caiu'); } }, https: httpsQueResponde(200, respostaDoGemini(PLANO_DE_AGENTE)), roteiro: (a) => detectar(a, 'dhundo gatos') },
  { nome: 'detectIntent com o motor do Gemini que lança no status avisa e usa a API', gemini: { autenticacao: () => { throw new Error('motor ausente'); } }, https: httpsQueResponde(200, respostaDoGemini(PLANO_DE_AGENTE)), roteiro: (a) => detectar(a, 'check karo isso') },
  { nome: 'detectIntent com a sessão do navegador respondendo só espaços devolve texto vazio sem chamar a API', gemini: geminiQueResponde('   '), https: httpsQueResponde(200, respostaDoGemini(PLANO_DE_AGENTE)), roteiro: (a) => detectar(a, 'search gatos') },
  { nome: 'detectIntent com a API respondendo só espaços devolve texto vazio sem tentar o segundo modelo', gemini: semNavegadorDoGemini, https: httpsQueResponde(200, respostaDoGemini('   ')), roteiro: (a) => detectar(a, 'search gatos') },
  { nome: 'detectIntent sem sessão do navegador guarda o pedido da API (host, caminho com a chave, cabeçalhos e corpo)', gemini: semNavegadorDoGemini, https: httpsQueResponde(200, respostaDoGemini(PLANO_DE_AGENTE)), roteiro: (a) => detectar(a, 'kam pe lag jao') },
  { nome: 'detectIntent: erro 400 do primeiro modelo para na hora e vira não-agente', gemini: semNavegadorDoGemini, https: httpsPorModelo([{ status: 400, corpo: { error: { message: 'x'.repeat(120) } } }]), roteiro: (a) => detectar(a, 'oi') },
  { nome: 'detectIntent: erro 403 do primeiro modelo para na hora e o comando explícito vira pesquisa', gemini: semNavegadorDoGemini, https: httpsPorModelo([{ status: 403, corpo: { error: { message: 'proibido' } } }]), roteiro: (a) => detectar(a, 'agent, ache receitas') },
  { nome: 'detectIntent: erro 500 do primeiro modelo tenta o segundo', gemini: semNavegadorDoGemini, https: httpsPorModelo([{ status: 500, corpo: { error: { message: 'queda' } } }, { status: 200, corpo: respostaDoGemini(PLANO_DE_AGENTE) }]), roteiro: (a) => detectar(a, 'oi') },
  { nome: 'detectIntent: erro sem mensagem no primeiro modelo mostra undefined no aviso e tenta o segundo', gemini: semNavegadorDoGemini, https: httpsPorModelo([{ status: 500, corpo: { error: {} } }, { status: 200, corpo: respostaDoGemini('{"isAgentTask": false}') }]), roteiro: (a) => detectar(a, 'oi') },
  { nome: 'detectIntent: resposta que não é JSON conta como falha do modelo e tenta o segundo', gemini: semNavegadorDoGemini, https: httpsPorModelo([{ status: 200, corpoBruto: '<html>' }, { status: 200, corpo: respostaDoGemini(PLANO_DE_AGENTE) }]), roteiro: (a) => detectar(a, 'oi') },
  { nome: 'detectIntent: erro de rede nos dois modelos desiste e usa o plano de fallback', gemini: semNavegadorDoGemini, https: httpsPorModelo([{ erroDeRede: 'rede caiu' }, { erroDeRede: 'rede caiu de novo' }]), roteiro: (a) => detectar(a, 'agents active pesquise tudo') },
  { nome: 'detectIntent: resposta sem texto nos dois modelos desiste', gemini: semNavegadorDoGemini, https: httpsPorModelo([{ status: 200, corpo: { candidates: [] } }, { status: 200, corpo: {} }]), roteiro: (a) => detectar(a, 'agent') },
  { nome: 'detectIntent: comando explícito com JSON sem tarefas ganha a pesquisa no lugar do comando', gemini: geminiQueResponde('{"isAgentTask": false}'), roteiro: async (a) => ({ virgula: await detectar(a, 'agent, ache receitas'), espaco: await detectar(a, 'Agent ache receitas'), ativos: await detectar(a, 'agents active') }) },
  { nome: 'detectIntent: comando explícito com tarefa do plano mantém o plano', gemini: geminiQueResponde('{"isAgentTask": false, "tasks": {"sysadmin": "abrir"}}'), roteiro: (a) => detectar(a, 'agent, abra o bloco de notas') },
  { nome: 'detectIntent: JSON quebrado dentro das chaves cai no fallback do comando', gemini: geminiQueResponde('{nao é json}'), roteiro: async (a) => ({ normal: await detectar(a, 'oi'), explicito: await detectar(a, 'agent, ache') }) },
  { nome: 'executeWorkflow recusa quando o enxame já está ativo', roteiro: async (a) => { a.controlador.isSwarmActive = true; return a.controlador.executeWorkflow('search gatos', 'k'); } },
  { nome: 'executeWorkflow de um comando que não é de agente devolve handled false e avisa', gemini: geminiQueResponde('{"isAgentTask": false}'), roteiro: (a) => executarEEsperar(a, 'oi tudo bem') },
  { nome: 'executeWorkflow delegado vai direto ao agente filho, avisa o WhatsApp e libera o enxame 3 segundos depois', whatsapp: {}, roteiro: async (a) => { const retorno = await executarEEsperar(a, 'pesquise gatos', true, 'modelo-x', 'chave-groq'); const ativoAntes = a.controlador.isSwarmActive; await a.avancar(3000); return { retorno, ativoAntes }; } },
  { nome: 'executeWorkflow com plano de agente conta os agentes, usa o modelo padrão e responde sem groq', gemini: geminiQueResponde('{"isAgentTask": true, "tasks": {"researcher": "a", "coder": "b", "downloader": "c", "sysadmin": "d"}}'), whatsapp: {}, roteiro: async (a) => { const retorno = await executarEEsperar(a, 'search gatos'); await a.avancar(3000); return retorno; } },
  { nome: 'executeWorkflow: o agente filho sem resposta final responde que terminou', filho: { responder: async () => ({ success: true }) }, whatsapp: {}, roteiro: async (a) => { const retorno = await executarEEsperar(a, 'tarefa', true); await a.avancar(3000); return retorno; } },
  { nome: 'executeWorkflow: o agente filho que falha com texto avisa o erro no log e no WhatsApp', filho: { responder: async () => ({ success: false, error: 'sem permissão' }) }, whatsapp: {}, roteiro: async (a) => { const retorno = await executarEEsperar(a, 'tarefa', true); await a.avancar(3000); return retorno; } },
  { nome: 'executeWorkflow: o agente filho que falha sem texto usa Worker failed', filho: { responder: async () => ({ success: false }) }, whatsapp: {}, roteiro: async (a) => { const retorno = await executarEEsperar(a, 'tarefa', true); await a.avancar(3000); return retorno; } },
  { nome: 'executeWorkflow: SWARM_CANCELLED não vira erro nem aviso', filho: { responder: async () => { throw new Error('SWARM_CANCELLED'); } }, whatsapp: {}, roteiro: async (a) => { const retorno = await executarEEsperar(a, 'tarefa', true); await a.avancar(3000); return retorno; } },
  { nome: 'executeWorkflow: o WhatsApp fora do ar ou sem número não recebe nada e o que quebra só avisa', whatsapp: { pronto: false }, roteiro: async (a) => { const retorno = await executarEEsperar(a, 'tarefa', true); await a.avancar(3000); return retorno; } },
  { nome: 'executeWorkflow: o WhatsApp sem número do dono não recebe nada', whatsapp: { semId: true }, roteiro: async (a) => { const retorno = await executarEEsperar(a, 'tarefa', true); await a.avancar(3000); return retorno; } },
  { nome: 'executeWorkflow: a falha ao enviar pelo WhatsApp só vira aviso', whatsapp: { falha: 'sem rede' }, roteiro: async (a) => { const retorno = await executarEEsperar(a, 'tarefa', true); await a.avancar(3000); return retorno; } },
  { nome: 'executeWorkflow: o pipeline do YouTube sobe o Python com o roteiro, repassa as linhas e libera no fim bem-sucedido', roteiro: (a) => pipelineDoYoutube(a, 'Youtube Auto Upload', (processo) => { dadosDoProcesso(processo, '{"message":"enviando"}\nlinha solta\n\n{"sem":"mensagem"}\n'); processo.stderr.emit('data', Buffer.from('aviso')); processo.emit('close', 0); }) },
  { nome: 'executeWorkflow: o pipeline do YouTube com um vídeo escolhido manda o nome ao Python', roteiro: (a) => pipelineDoYoutube(a, 'youtube upload meu-video.mp4 agora', (processo) => processo.emit('close', 0)) },
  { nome: 'executeWorkflow: o pipeline do YouTube ignora o nome que tem auto e termina com erro sem avisar sucesso', roteiro: (a) => pipelineDoYoutube(a, 'meri video upload kar do', (processo) => processo.emit('close', 3)) },
  { nome: 'executeWorkflow: youtube upload auto não manda nome de vídeo', roteiro: (a) => pipelineDoYoutube(a, 'youtube upload auto-teste', (processo) => processo.emit('close', 0)) },
  { nome: 'cancel sem enxame ativo não faz nada', roteiro: async (a) => { a.controlador.cancel(); await a.avancar(500); return null; } },
  { nome: 'cancel com enxame ativo mata o filho, avisa e volta os agentes para idle depois de meio segundo', roteiro: async (a) => { a.controlador.isSwarmActive = true; a.controlador.activeChild = { kill: (sinal) => a.eventos().push(['filho.kill', sinal]) }; a.controlador.cancel(); const antes = { ativo: a.controlador.isSwarmActive, cancelado: a.controlador.isCancelled, filho: a.controlador.activeChild }; await a.avancar(500); return antes; } },
  { nome: 'cancel com filho que não deixa matar segue adiante', roteiro: async (a) => { a.controlador.isSwarmActive = true; a.controlador.activeChild = { kill: () => { throw new Error('não mata'); } }; a.controlador.cancel(); await a.avancar(500); return null; } },
  { nome: 'log, status e broadcast com a janela destruída só escrevem no console', janela: { destruida: true }, roteiro: async (a) => { a.controlador.log('sysadmin', 'texto'); a.controlador.setStatus('coder', 'busy', 40); a.controlador.broadcast('x', { y: 1 }); return null; } },
  { nome: 'log formata o agente em maiúsculas e troca SYSADMIN por SYS ADMIN', roteiro: async (a) => { a.controlador.log('ceo', 'um'); a.controlador.log('sysadmin', 'dois'); a.controlador.log('researcher', 'três'); a.controlador.setStatus('coder', 'busy'); a.controlador.setStatus('coder', 'busy', 55); return null; } },
  { nome: 'o YouTube visível acha o endereço, fecha o navegador e traz a janela do Nova', navegador: navegadorQueAchaNaTentativa(3, true), roteiro: (a) => baixarDoYoutube(a, 'lofi hip hop') },
  { nome: 'o YouTube visível sem janela do Nova ou destruída não mostra nada', janela: { destruida: true }, navegador: navegadorQueAchaNaTentativa(1), roteiro: (a) => baixarDoYoutube(a, 'musica') },
  { nome: 'o YouTube visível que nunca acha o endereço tenta vinte vezes, fecha e devolve null', navegador: navegadorQueAchaNaTentativa(999), roteiro: (a) => baixarDoYoutube(a, 'sem resultado') },
  { nome: 'o YouTube visível com erro ao abrir o navegador fecha e devolve null', navegador: { responder: async (metodo) => { if (metodo === 'launch') throw new Error('sem navegador'); return undefined; } }, roteiro: (a) => baixarDoYoutube(a, 'x') },
  { nome: 'o YouTube visível com erro e o fechamento também falhando ainda devolve null', navegador: { responder: async (metodo) => { if (metodo === 'launch' || metodo === 'close') throw new Error('falhou'); return undefined; } }, roteiro: (a) => baixarDoYoutube(a, 'x') },
  { nome: 'o YouTube visível depois de cancelar rejeita com SWARM_CANCELLED antes de abrir o navegador', roteiro: async (a) => { a.controlador.isCancelled = true; try { await a.controlador.executeVisibleYouTubeDownload('x'); return 'não rejeitou'; } catch (erro) { return erro.message; } } },
];
