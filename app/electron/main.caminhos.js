const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const ARQUIVOS_DA_MIGRACAO = [
  'memories.json', 'user_profile.json', 'dashboard_settings.json',
  'imported_folders.json', 'history.json', 'history_settings.json',
  'contacts.json', 'notes.json', 'tasks.json', 'secret_key.json',
  'groq_key.json', 'openrouter_key.json', 'thinking_settings.json',
  'gemini_preference.json', 'chats.json', 'custom_models.json',
  'whatsapp_settings.json'
];

const ARQUIVOS_DO_BACKUP = [
  'secret_key.json', 'whatsapp_settings.json', 'dashboard_settings.json',
  'thinking_settings.json', 'gemini_preference.json', 'visual_settings.json',
  'elevenlabs_settings.json', 'google_key.json', 'groq_key.json', 'openrouter_key.json'
];

const naPastaDoUsuario = (arquivo) => () => path.join(app.getPath('userData'), arquivo);

const getMemoryPath = naPastaDoUsuario('memories.json');
const getUserProfilePath = naPastaDoUsuario('user_profile.json');
const getDashboardSettingsPath = naPastaDoUsuario('dashboard_settings.json');
const getFolderConfigPath = naPastaDoUsuario('imported_folders.json');
const getVaultPath = () => path.join(app.getPath('documents'), 'Nova_Vault');
const getHistoryPath = naPastaDoUsuario('history.json');
const getHistorySettingsPath = naPastaDoUsuario('history_settings.json');
const getContactsPath = naPastaDoUsuario('contacts.json');
const getNotesPath = naPastaDoUsuario('notes.json');
const getTasksPath = naPastaDoUsuario('tasks.json');
const getSecretKeyPath = naPastaDoUsuario('secret_key.json');
const getGroqKeyPath = naPastaDoUsuario('groq_key.json');
const getOpenRouterKeyPath = naPastaDoUsuario('openrouter_key.json');
const getThinkingSettingsPath = naPastaDoUsuario('thinking_settings.json');
const getGeminiPreferencePath = naPastaDoUsuario('gemini_preference.json');
const getChildAgentModelPath = naPastaDoUsuario('child_agent_model.json');
const getChildAgentKeyPath = naPastaDoUsuario('child_agent_key.json');
const getNovaVoicePath = naPastaDoUsuario('nova_voice.json');
const getChatsPath = naPastaDoUsuario('chats.json');
const getCustomModelsPath = naPastaDoUsuario('custom_models.json');
const getWhatsAppSettingsPath = naPastaDoUsuario('whatsapp_settings.json');
const getGoogleKeyPath = naPastaDoUsuario('google_key.json');
const getVisualSettingsPath = naPastaDoUsuario('visual_settings.json');
const getElevenLabsSettingsPath = naPastaDoUsuario('elevenlabs_settings.json');
const getWaApiKeyPath = naPastaDoUsuario('wa_api_key.json');
const getBackupConfigPath = () => path.join(process.cwd(), 'config_bak_C.dat');

function copiarArquivosDaPasta(origem, destino) {
  fs.readdirSync(origem).forEach(file => {
    const src = path.join(origem, file);
    if (fs.lstatSync(src).isFile()) fs.copyFileSync(src, path.join(destino, file));
  });
}

function migrarDocumentos(documentos) {
  const antiga = path.join(documentos, 'Stonic Data');
  const nova = path.join(documentos, 'Nova Data');
  if (fs.existsSync(nova) || !fs.existsSync(antiga)) return;
  console.info('[Migration] Copying Nova Data...');
  fs.mkdirSync(nova, { recursive: true });
  copiarArquivosDaPasta(antiga, nova);
}

function migrarCofre(documentos) {
  const antigo = path.join(documentos, 'Stonic_Vault');
  const novo = path.join(documentos, 'Nova_Vault');
  if (fs.existsSync(novo) || !fs.existsSync(antigo)) return;
  console.info('[Migration] Renaming old vault to Nova_Vault...');
  fs.renameSync(antigo, novo);
}

function copiarArquivoDoPerfilAntigo(antigo, novo, file) {
  const src = path.join(antigo, file);
  const dest = path.join(novo, file);
  if (!fs.existsSync(src) || fs.existsSync(dest)) return;
  console.info(`[Migration] Copying ${file} to new profile...`);
  fs.copyFileSync(src, dest);
}

function migrarPerfil() {
  const novo = app.getPath('userData');
  const antigo = path.join(path.dirname(novo), 'Stonic AI');
  if (!fs.existsSync(antigo) || antigo === novo) return;
  ARQUIVOS_DA_MIGRACAO.forEach(file => copiarArquivoDoPerfilAntigo(antigo, novo, file));
}

const migrateStonicToNova = () => {
  try {
    const documentos = app.getPath('documents');
    migrarDocumentos(documentos);
    migrarCofre(documentos);
    migrarPerfil();
  } catch (error) {
    console.error('[Migration] Failed:', error);
  }
};

const ensureNovaDirectories = () => {
  try {
    migrateStonicToNova();
    const notesPath = path.join(app.getPath('documents'), 'Nova Data');
    if (!fs.existsSync(notesPath)) {
      fs.mkdirSync(notesPath, { recursive: true });
      console.info('Created Nova Data directory:', notesPath);
    }
    return notesPath;
  } catch (error) {
    console.error('Failed to create Nova directories:', error);
    return null;
  }
};

function empacotarArquivo(userData, file, backupData) {
  const p = path.join(userData, file);
  if (!fs.existsSync(p)) return;
  try {
    backupData[file] = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { console.error(`Failed to pack ${file}:`, e); }
}

const syncConfigurationBackup = () => {
  try {
    const userData = app.getPath('userData');
    const backupPath = getBackupConfigPath();
    const backupData = {};
    ARQUIVOS_DO_BACKUP.forEach(file => empacotarArquivo(userData, file, backupData));
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
    return { success: true, count: Object.keys(backupData).length };
  } catch (error) {
    console.error('Backup failed:', error);
    return { success: false, error: error.message };
  }
};

const restoreConfigurationBackup = () => {
  try {
    const backupPath = getBackupConfigPath();
    if (!fs.existsSync(backupPath)) return { success: false, error: 'Backup file not found' };

    const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    const userData = app.getPath('userData');
    const arquivos = Object.keys(backupData);
    arquivos.forEach(file => fs.writeFileSync(path.join(userData, file), JSON.stringify(backupData[file], null, 2)));
    return { success: true, count: arquivos.length };
  } catch (error) {
    console.error('Restore failed:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  getMemoryPath, getUserProfilePath, getDashboardSettingsPath, getFolderConfigPath, getVaultPath,
  getHistoryPath, getHistorySettingsPath, getContactsPath, getNotesPath, getTasksPath,
  getSecretKeyPath, getGroqKeyPath, getOpenRouterKeyPath, getThinkingSettingsPath,
  getGeminiPreferencePath, getChildAgentModelPath, getChildAgentKeyPath, getNovaVoicePath,
  getChatsPath, getCustomModelsPath, getWhatsAppSettingsPath, getGoogleKeyPath,
  getVisualSettingsPath, getElevenLabsSettingsPath, getWaApiKeyPath,
  ensureNovaDirectories, syncConfigurationBackup, restoreConfigurationBackup,
};
