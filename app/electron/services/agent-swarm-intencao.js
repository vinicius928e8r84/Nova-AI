'use strict';

const PALAVRAS_DE_GATILHO = ['search', 'dhundo', 'agent', 'download', 'script', 'check karo', 'kam pe'];
const INICIOS_DE_COMANDO_EXPLICITO = ['agents active', 'agent,', 'agent '];
const INICIO_DO_COMANDO_EXPLICITO = /^(agents active|agent,|agent\s)/i;
const AGENTES_DO_PLANO = ['researcher', 'coder', 'sysadmin', 'downloader'];

const temGatilho = (comando) => PALAVRAS_DE_GATILHO.some((palavra) => comando.includes(palavra));

const ehComandoExplicito = (comando) => INICIOS_DE_COMANDO_EXPLICITO.some((inicio) => comando.startsWith(inicio));

function pesquisaDoComando(comando) {
  return comando.replace(INICIO_DO_COMANDO_EXPLICITO, '').trim() || comando;
}

function montarPedidoDeIntencao(command, isForced) {
  return `You are Nova AI's Agent Swarm Orchestrator. Analyze if this user command needs multiple specialized agents.

User Command: "${command}"

Agents available:
1. RESEARCHER  - Web search, finding links, gathering info
2. CODER       - Prepare shell commands for Windows
3. DOWNLOADER  - Download files (software, media, docs)
4. SYSADMIN    - Run executables, install software, system commands

Return ONLY valid JSON, no markdown, no backticks:
{
  "isAgentTask": true,
  "reason": "brief why",
  "tasks": {
    "researcher": "search query string or null",
    "coder": "what command to build or null",
    "downloader": "what to download or null",
    "sysadmin": "what command to run or null"
  },
  "fileDetails": {
    "directory": "e.g. Desktop or null",
    "folderName": "e.g. Calculator or null",
    "fileName": "e.g. calc.txt or null"
  },
  "dependencyChain": ["researcher -> coder", "coder -> downloader"]
}

RULES:
- CRITICAL: The user will frequently speak in URDU/HINDI.
- Target Folder Extraction: If the user says 'desktop', use '$HOME\\Desktop'. If they name a folder (e.g. 'calculter nam ke folder'), capture 'calculter' as folderName.
- Filename Extraction: If they say 'save karo .txt name se', capture '.txt' as fileName.
- Translate the intent to English internally. If the intent is an ACTION, isAgentTask MUST be true.
- ${isForced ? "CRITICAL MANDATORY OVERRIDE: The user used a trigger word like 'agent', 'search', or 'download'. You MUST return isAgentTask: true. Extract the core subject for the researcher query." : "- Only return false for pure conversational small talk (e.g. 'kese ho', 'hello')."}
- For RESEARCHER tasks, DO NOT put the whole Urdu sentence as the query. Extract ONLY the precise English keywords. 
  *Example*: Urdu: "muje caculater ke liye net se script dhundo" -> Query: "calculator script source code windows"
  *Example*: Urdu: "latest AI news check karo" -> Query: "latest AI news 2026"`;
}

function planoDeFallback(comando, explicito) {
  return { isAgentTask: explicito, tasks: explicito ? { researcher: pesquisaDoComando(comando) } : {} };
}

function temAlgumaTarefa(tarefas) {
  return AGENTES_DO_PLANO.some((agente) => tarefas[agente]);
}

function reforcarPlanoExplicito(plano, comando) {
  plano.isAgentTask = true;
  if (!plano.tasks) plano.tasks = {};
  if (!temAlgumaTarefa(plano.tasks)) plano.tasks.researcher = pesquisaDoComando(comando);
  return plano;
}

function planoDoTexto(texto, comando, explicito) {
  const achado = texto.match(/\{[\s\S]*\}/);
  if (!achado) return planoDeFallback(comando, explicito);
  const plano = JSON.parse(achado[0]);
  return explicito ? reforcarPlanoExplicito(plano, comando) : plano;
}

module.exports = { temGatilho, ehComandoExplicito, montarPedidoDeIntencao, planoDoTexto, planoDeFallback };
