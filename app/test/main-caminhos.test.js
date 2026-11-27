'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { carregarMain } = require('./ajuda/carregar-main');

const GRAVADORES_DA_PASTA_DO_USUARIO = [
  ['save-memories', [{ a: 1 }], 'memories.json'],
  ['save-user-profile', [{ a: 1 }], 'user_profile.json'],
  ['save-dashboard-settings', [{ a: 1 }], 'dashboard_settings.json'],
  ['save-imported-folders', [['x']], 'imported_folders.json'],
  ['save-history', [[{ a: 1 }]], 'history.json'],
  ['save-history-settings', [{ a: 1 }], 'history_settings.json'],
  ['save-contacts', [[{ a: 1 }]], 'contacts.json'],
  ['save-notes', [[{ a: 1 }]], 'notes.json'],
  ['save-tasks', [[{ a: 1 }]], 'tasks.json'],
  ['save-groq-token', ['chave-groq'], 'groq_key.json'],
  ['save-openrouter-token', ['chave-or'], 'openrouter_key.json'],
  ['save-thinking-enabled', [true], 'thinking_settings.json'],
  ['save-prefer-direct-gemini', [true], 'gemini_preference.json'],
  ['save-child-agent-model', ['modelo'], 'child_agent_model.json'],
  ['save-child-agent-key', ['chave-filho'], 'child_agent_key.json'],
  ['save-nova-voice', ['voz'], 'nova_voice.json'],
  ['save-chats', [[{ a: 1 }]], 'chats.json'],
  ['save-custom-models', [{ openRouter: [], gemini: [] }], 'custom_models.json'],
  ['save-whatsapp-settings', [{ a: 1 }], 'whatsapp_settings.json'],
  ['save-google-token', ['chave-google'], 'google_key.json'],
  ['save-visual-feed-enabled', [true], 'visual_settings.json'],
  ['save-elevenlabs-settings', [{ a: 1 }], 'elevenlabs_settings.json'],
  ['save-wa-api-key', ['chave-wa'], 'wa_api_key.json'],
  ['save-gemini-token', ['chave-gemini'], 'secret_key.json'],
];

const ARQUIVOS_DO_BACKUP = [
  'secret_key.json', 'whatsapp_settings.json', 'dashboard_settings.json',
  'thinking_settings.json', 'gemini_preference.json', 'visual_settings.json',
  'elevenlabs_settings.json', 'google_key.json', 'groq_key.json', 'openrouter_key.json',
];

const ARQUIVOS_DA_MIGRACAO = [
  'memories.json', 'user_profile.json', 'dashboard_settings.json',
  'imported_folders.json', 'history.json', 'history_settings.json',
  'contacts.json', 'notes.json', 'tasks.json', 'secret_key.json',
  'groq_key.json', 'openrouter_key.json', 'thinking_settings.json',
  'gemini_preference.json', 'chats.json', 'custom_models.json',
  'whatsapp_settings.json',
];

function gravar(arquivo, conteudo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, conteudo);
}

function listar(pasta) {
  return fs.existsSync(pasta) ? fs.readdirSync(pasta).sort() : null;
}

function comPastaDeTrabalho(funcao) {
  const antes = process.cwd();
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-cwd-'));
  process.chdir(pasta);
  const restaurar = () => { process.chdir(antes); fs.rmSync(pasta, { recursive: true, force: true }); };
  return Promise.resolve().then(() => funcao(pasta)).finally(restaurar);
}

test('cada gravador de preferência escreve no arquivo certo da pasta do usuário', async () => {
  const main = carregarMain();
  const usuario = main.pasta('userData');
  for (const [canal, argumentos, arquivo] of GRAVADORES_DA_PASTA_DO_USUARIO) {
    assert.strictEqual(await main.invocar(canal, ...argumentos), true, canal);
    assert.ok(fs.existsSync(path.join(usuario, arquivo)), `${canal} -> ${arquivo}`);
  }
  const gravados = fs.readdirSync(usuario).sort();
  assert.deepStrictEqual(gravados, GRAVADORES_DA_PASTA_DO_USUARIO.map(([, , arquivo]) => arquivo).sort());
});

test('save-vault-md grava em Documentos/Nova_Vault/Chats', async () => {
  const main = carregarMain();
  assert.strictEqual(await main.invocar('save-vault-md', { filename: 'conversa.md', content: 'olá' }), true);
  assert.strictEqual(fs.readFileSync(path.join(main.pasta('documents'), 'Nova_Vault', 'Chats', 'conversa.md'), 'utf8'), 'olá');
});

test('a abertura cria Documentos/Nova Data e nada mais quando não há pasta antiga', () => {
  const main = carregarMain();
  assert.deepStrictEqual(listar(main.pasta('documents')), ['Nova Data']);
  assert.deepStrictEqual(listar(path.join(main.pasta('documents'), 'Nova Data')), []);
});

test('migração: copia só os arquivos de Stonic Data para Nova Data, sem as subpastas', () => {
  const main = carregarMain({
    preparar: (raiz) => {
      const antiga = path.join(raiz, 'documents', 'Stonic Data');
      gravar(path.join(antiga, 'a.txt'), 'um');
      gravar(path.join(antiga, 'b.json'), '{"b":2}');
      gravar(path.join(antiga, 'sub', 'c.txt'), 'três');
    },
  });
  const nova = path.join(main.pasta('documents'), 'Nova Data');
  assert.deepStrictEqual(listar(nova), ['a.txt', 'b.json']);
  assert.strictEqual(fs.readFileSync(path.join(nova, 'b.json'), 'utf8'), '{"b":2}');
  assert.deepStrictEqual(listar(path.join(main.pasta('documents'), 'Stonic Data')), ['a.txt', 'b.json', 'sub']);
});

test('migração: não copia nada quando Nova Data já existe', () => {
  const main = carregarMain({
    preparar: (raiz) => {
      gravar(path.join(raiz, 'documents', 'Stonic Data', 'a.txt'), 'um');
      gravar(path.join(raiz, 'documents', 'Nova Data', 'x.txt'), 'novo');
    },
  });
  assert.deepStrictEqual(listar(path.join(main.pasta('documents'), 'Nova Data')), ['x.txt']);
});

test('migração: Stonic_Vault vira Nova_Vault por renomeação, e fica quieta se Nova_Vault já existe', () => {
  const principal = carregarMain({ preparar: (raiz) => gravar(path.join(raiz, 'documents', 'Stonic_Vault', 'n.md'), 'nota') });
  assert.deepStrictEqual(listar(principal.pasta('documents')), ['Nova Data', 'Nova_Vault']);
  assert.deepStrictEqual(listar(path.join(principal.pasta('documents'), 'Nova_Vault')), ['n.md']);

  const ocupado = carregarMain({
    preparar: (raiz) => {
      gravar(path.join(raiz, 'documents', 'Stonic_Vault', 'n.md'), 'nota');
      gravar(path.join(raiz, 'documents', 'Nova_Vault', 'outra.md'), 'outra');
    },
  });
  assert.deepStrictEqual(listar(ocupado.pasta('documents')), ['Nova Data', 'Nova_Vault', 'Stonic_Vault']);
  assert.deepStrictEqual(listar(path.join(ocupado.pasta('documents'), 'Nova_Vault')), ['outra.md']);
});

test('migração: copia do perfil Stonic AI só a lista conhecida e nunca por cima do que já existe', () => {
  const main = carregarMain({
    preparar: (raiz) => {
      for (const arquivo of ARQUIVOS_DA_MIGRACAO) gravar(path.join(raiz, 'Stonic AI', arquivo), `antigo-${arquivo}`);
      gravar(path.join(raiz, 'Stonic AI', 'outro.json'), 'fora da lista');
      gravar(path.join(raiz, 'userData', 'notes.json'), 'ja-existe');
    },
  });
  const usuario = main.pasta('userData');
  assert.deepStrictEqual(listar(usuario), ARQUIVOS_DA_MIGRACAO.slice().sort());
  assert.strictEqual(fs.readFileSync(path.join(usuario, 'notes.json'), 'utf8'), 'ja-existe');
  assert.strictEqual(fs.readFileSync(path.join(usuario, 'memories.json'), 'utf8'), 'antigo-memories.json');
});

test('migração: um erro no meio é engolido, interrompe o resto e a abertura continua', () => {
  const main = carregarMain({
    preparar: (raiz) => {
      gravar(path.join(raiz, 'documents', 'Stonic Data'), 'isto é um arquivo');
      gravar(path.join(raiz, 'documents', 'Stonic_Vault', 'n.md'), 'nota');
      gravar(path.join(raiz, 'Stonic AI', 'memories.json'), 'antigo');
    },
  });
  assert.deepStrictEqual(listar(main.pasta('documents')), ['Nova Data', 'Stonic Data', 'Stonic_Vault']);
  assert.deepStrictEqual(listar(main.pasta('userData')), []);
});

test('sync-configuration-backup exportar: junta os arquivos conhecidos em config_bak_C.dat e pula o JSON quebrado', async () => {
  await comPastaDeTrabalho(async (pasta) => {
    const main = carregarMain();
    const usuario = main.pasta('userData');
    gravar(path.join(usuario, 'secret_key.json'), '{"apiKey":"k"}');
    gravar(path.join(usuario, 'visual_settings.json'), '{"enabled":true}');
    gravar(path.join(usuario, 'groq_key.json'), '{quebrado');
    gravar(path.join(usuario, 'memories.json'), '{"fora":1}');
    const resposta = await main.invocar('sync-configuration-backup', { action: 'export' });
    assert.deepStrictEqual(resposta, { success: true, count: 2 });
    const esperado = { 'secret_key.json': { apiKey: 'k' }, 'visual_settings.json': { enabled: true } };
    assert.strictEqual(fs.readFileSync(path.join(pasta, 'config_bak_C.dat'), 'utf8'), JSON.stringify(esperado, null, 2));
  });
});

test('sync-configuration-backup exportar: os dez arquivos entram na ordem da lista', async () => {
  await comPastaDeTrabalho(async (pasta) => {
    const main = carregarMain();
    for (const arquivo of ARQUIVOS_DO_BACKUP.slice().reverse()) gravar(path.join(main.pasta('userData'), arquivo), JSON.stringify({ de: arquivo }));
    assert.deepStrictEqual(await main.invocar('sync-configuration-backup', { action: 'export' }), { success: true, count: 10 });
    const backup = JSON.parse(fs.readFileSync(path.join(pasta, 'config_bak_C.dat'), 'utf8'));
    assert.deepStrictEqual(Object.keys(backup), ARQUIVOS_DO_BACKUP);
    assert.deepStrictEqual(backup['groq_key.json'], { de: 'groq_key.json' });
  });
});

test('sync-configuration-backup exportar: sem nenhum arquivo grava um backup vazio', async () => {
  await comPastaDeTrabalho(async (pasta) => {
    const main = carregarMain();
    assert.deepStrictEqual(await main.invocar('sync-configuration-backup', { action: 'export' }), { success: true, count: 0 });
    assert.strictEqual(fs.readFileSync(path.join(pasta, 'config_bak_C.dat'), 'utf8'), '{}');
  });
});

test('sync-configuration-backup importar: sem backup, com backup e com backup quebrado', async () => {
  await comPastaDeTrabalho(async (pasta) => {
    const main = carregarMain();
    assert.deepStrictEqual(await main.invocar('sync-configuration-backup', { action: 'import' }), { success: false, error: 'Backup file not found' });

    gravar(path.join(pasta, 'config_bak_C.dat'), JSON.stringify({ 'secret_key.json': { apiKey: 'k' }, 'qualquer.json': [1] }));
    assert.deepStrictEqual(await main.invocar('sync-configuration-backup', { action: 'import' }), { success: true, count: 2 });
    assert.strictEqual(fs.readFileSync(path.join(main.pasta('userData'), 'secret_key.json'), 'utf8'), JSON.stringify({ apiKey: 'k' }, null, 2));
    assert.strictEqual(fs.readFileSync(path.join(main.pasta('userData'), 'qualquer.json'), 'utf8'), JSON.stringify([1], null, 2));

    gravar(path.join(pasta, 'config_bak_C.dat'), '{quebrado');
    let mensagem;
    try { JSON.parse('{quebrado'); } catch (erro) { mensagem = erro.message; }
    assert.deepStrictEqual(await main.invocar('sync-configuration-backup', { action: 'import' }), { success: false, error: mensagem });
  });
});

test('sync-configuration-backup: ação desconhecida', async () => {
  const main = carregarMain();
  assert.deepStrictEqual(await main.invocar('sync-configuration-backup', { action: 'apagar' }), { success: false, error: 'Invalid action' });
});
