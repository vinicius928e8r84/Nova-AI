const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const mime = require('mime-types');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');

const LIMITE_DO_ANEXO_EM_BYTES = 50 * 1024 * 1024;
const ITENS_DA_LISTA_DE_PASTA = 50;
const LETRAS_DE_DOCUMENTS_E_BARRA = 'Documents/'.length;
const TIPO_DO_PDF = 'application/pdf';
const TIPO_DO_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TIPOS_LIDOS_COMO_TEXTO = ['application/json', 'application/javascript'];
const EXTENSOES_LIDAS_COMO_TEXTO = ['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.css'];
const VARIAVEL_LITERAL_DAS_NOTAS = /\$\{?resolvedNotesPath\}?[\\\/]?/g;

const FILTRO_DE_MIDIA = [{ name: 'Media Files', extensions: ['mp4', 'mkv', 'avi', 'jpg', 'jpeg', 'png'] }];
const FILTRO_DE_AUDIO_WAV = [{ name: 'Audio Files', extensions: ['wav'] }];
const FILTRO_DE_VIDEOS = [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov'] }];
const FILTRO_DE_AUDIOS = [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac'] }];
const FILTRO_DE_IMAGENS = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }];
const FILTRO_DOS_ANEXOS = [
  { name: 'Multimodal Files', extensions: ['jpg', 'png', 'jpeg', 'webp', 'pdf', 'doc', 'docx', 'txt', 'mp3', 'wav', 'mpeg'] },
];

const FILTROS_POR_TIPO_DE_MIDIA = new Map([['video', FILTRO_DE_VIDEOS], ['audio', FILTRO_DE_AUDIOS]]);

function escolherNaJanelaPrincipal(janelaPrincipal) {
  return async function escolher(evento, opcoes) {
    const janela = janelaPrincipal();
    if (!janela) return null;
    const resultado = await dialog.showOpenDialog(janela, opcoes || { properties: ['openFile'] });
    return resultado.canceled ? null : resultado;
  };
}

function escolherUmArquivoNaJanelaPrincipal(janelaPrincipal, filtros) {
  return async function escolher() {
    const janela = janelaPrincipal();
    if (!janela) return null;
    const resultado = await dialog.showOpenDialog(janela, { properties: ['openFile'], filters: filtros });
    return resultado.canceled ? null : resultado.filePaths[0];
  };
}

async function escolherUmCaminho(opcoes) {
  const resultado = await dialog.showOpenDialog(opcoes);
  if (!resultado.canceled && resultado.filePaths.length > 0) return resultado.filePaths[0];
  return null;
}

async function escolherVariosCaminhos(opcoes) {
  const resultado = await dialog.showOpenDialog(opcoes);
  if (!resultado.canceled && resultado.filePaths.length > 0) return resultado.filePaths;
  return null;
}

function escolherArquivoDeMidia(evento, tipo) {
  const filtros = FILTROS_POR_TIPO_DE_MIDIA.get(tipo) || FILTRO_DE_IMAGENS;
  return escolherUmCaminho({ properties: ['openFile'], filters: filtros });
}

function escolherPasta() {
  return escolherUmCaminho({ properties: ['openDirectory'] });
}

function escolherVariasMidias(evento, tipo) {
  const filtros = tipo === 'video' ? FILTRO_DE_VIDEOS : FILTRO_DE_AUDIOS;
  return escolherVariosCaminhos({ properties: ['openFile', 'multiSelections'], filters: filtros });
}

async function abrirArquivo(evento, caminho) {
  try {
    const erro = await shell.openPath(caminho);
    if (!erro) return true;
    console.error('Failed to open file:', erro);
    return false;
  } catch (erro) {
    console.error('Failed to open file exception:', erro);
    return false;
  }
}

async function apagarArquivo(evento, caminho) {
  try {
    if (fs.existsSync(caminho)) fs.unlinkSync(caminho);
    return true;
  } catch (erro) {
    console.error('Error deleting file:', erro);
    return false;
  }
}

async function salvarVideo(evento, origem, nome) {
  try {
    const { filePath } = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), {
      title: 'Salvar Vídeo',
      defaultPath: nome,
      filters: [{ name: 'Videos', extensions: ['mp4'] }],
    });
    if (!filePath) return false;
    fs.copyFileSync(origem, filePath);
    return true;
  } catch (erro) {
    console.error('Failed to save file:', erro);
    return false;
  }
}

async function abrirNoSistema(evento, { target }) {
  const open = (await import('open')).default;
  await open(target);
  return true;
}

async function salvarImagem(evento, { base64Data }) {
  const arquivo = path.join(app.getPath('downloads'), `NOVA_Generated_${Date.now()}.png`);
  fs.writeFileSync(arquivo, Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
  return arquivo;
}

const ehPdf = ({ mimeType, extensao }) => mimeType === TIPO_DO_PDF || extensao === '.pdf';
const ehDocx = ({ mimeType, extensao }) => mimeType === TIPO_DO_DOCX || extensao === '.docx';
const ehTextoPelaLista = ({ mimeType, extensao }) => TIPOS_LIDOS_COMO_TEXTO.includes(mimeType) || EXTENSOES_LIDAS_COMO_TEXTO.includes(extensao);
function ehTexto(arquivo) {
  const { mimeType } = arquivo;
  return mimeType.startsWith('text/') || ehTextoPelaLista(arquivo);
}

async function lerPdf({ buffer }) {
  console.info('[File-Reader] Parsing PDF...');
  const dados = await PDFParse(buffer);
  console.info(`[File-Reader] PDF Parsed. Content length: ${dados.text?.length || 0}`);
  return { content: dados.text };
}

async function lerDocx({ buffer }) {
  console.info('[File-Reader] Parsing Docx...');
  const resultado = await mammoth.extractRawText({ buffer });
  console.info(`[File-Reader] Docx Parsed. Content length: ${resultado.value?.length || 0}`);
  return { content: resultado.value };
}

async function lerTexto({ buffer }) {
  console.info('[File-Reader] Reading as Text...');
  return { content: buffer.toString('utf8') };
}

function avisarQueNaoEhTexto({ caminho, mimeType }) {
  console.warn(`[File-Reader] Unsupported file type: ${mimeType}`);
  return { content: `[Binary/Image File: ${path.basename(caminho)}]. The content of this file is visual or binary.` };
}

const LEITORES_POR_TIPO = [[ehPdf, lerPdf], [ehDocx, lerDocx], [ehTexto, lerTexto]];

async function lerPeloTipo(arquivo) {
  const leitor = LEITORES_POR_TIPO.find(([serve]) => serve(arquivo));
  if (!leitor) return avisarQueNaoEhTexto(arquivo);
  return leitor[1](arquivo);
}

async function lerConteudoDoArquivo(evento, { path: caminho }) {
  try {
    console.info(`[File-Reader] Reading file: ${caminho}`);
    if (!fs.existsSync(caminho)) {
      console.error(`[File-Reader] File not found: ${caminho}`);
      return { error: 'File not found' };
    }
    const mimeType = mime.lookup(caminho);
    const extensao = path.extname(caminho).toLowerCase();
    const buffer = fs.readFileSync(caminho);
    console.info(`[File-Reader] Detected Mime: ${mimeType}, Ext: ${extensao}, Size: ${buffer.length} bytes`);
    const conteudo = await lerPeloTipo({ caminho, mimeType, extensao, buffer });
    return conteudo;
  } catch (erro) {
    console.error('[File-Reader] CRITICAL ERROR:', erro);
    return { error: erro.message };
  }
}

function lerAnexo(caminho) {
  return {
    name: path.basename(caminho),
    data: fs.readFileSync(caminho).toString('base64'),
    mimeType: mime.lookup(caminho) || 'application/octet-stream',
    path: caminho,
  };
}

const cabeNoAnexo = (caminho) => fs.statSync(caminho).size <= LIMITE_DO_ANEXO_EM_BYTES;

async function escolherELerAnexos() {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: FILTRO_DOS_ANEXOS });
  if (canceled) return [];
  return filePaths.filter(cabeNoAnexo).map(lerAnexo);
}

const temVariavelLiteral = (caminho) => caminho.includes('${resolvedNotesPath}') || caminho.includes('$resolvedNotesPath');
const comecaComPasta = (caminho, pasta) => caminho.startsWith(`${pasta}\\`) || caminho.startsWith(`${pasta}/`);

function corrigirVariavelLiteral(original, onde) {
  console.warn(`[FS-OP] WARNING: AI used literal template variable${onde} "${original}". Fixing...`);
  const restante = original.replace(VARIAVEL_LITERAL_DAS_NOTAS, '');
  const documentos = app.getPath('documents');
  const corrigido = restante ? path.join(documentos, 'Nova Data', restante) : documentos + path.sep + 'Nova Data';
  console.info(`[FS-OP] Fixed literal variable${onde}: ${original} → ${corrigido}`);
  return corrigido;
}

function resolverCaminhoRelativo(caminho) {
  const documentos = app.getPath('documents');
  if (comecaComPasta(caminho, 'Documents')) return path.join(documentos, caminho.substring(LETRAS_DE_DOCUMENTS_E_BARRA));
  if (comecaComPasta(caminho, 'Nova Data')) return path.join(documentos, caminho);
  return path.join(documentos, 'Nova Data', caminho);
}

function resolverCaminhoDoPedido(caminho) {
  if (!caminho) return caminho;
  if (temVariavelLiteral(caminho)) return corrigirVariavelLiteral(caminho, '');
  if (path.isAbsolute(caminho)) return caminho;
  const resolvido = resolverCaminhoRelativo(caminho);
  console.info(`[FS-OP] Resolved relative path: ${caminho} → ${resolvido}`);
  return resolvido;
}

function resolverDestinoDoPedido(destino) {
  if (!destino) return destino;
  if (temVariavelLiteral(destino)) return corrigirVariavelLiteral(destino, ' in dest');
  if (path.isAbsolute(destino)) return destino;
  return resolverCaminhoRelativo(destino);
}

const caminhoAbsoluto = (caminho) => (caminho ? path.resolve(caminho) : caminho);

function listarPasta({ caminho }) {
  const itens = fs.readdirSync(caminho);
  if (itens.length <= ITENS_DA_LISTA_DE_PASTA) return itens;
  const resto = itens.length - ITENS_DA_LISTA_DE_PASTA;
  return [...itens.slice(0, ITENS_DA_LISTA_DE_PASTA), `... and ${resto} more items (Truncated for stability)`];
}

function criarPasta({ caminho }) {
  if (!fs.existsSync(caminho)) fs.mkdirSync(caminho, { recursive: true });
  return true;
}

function gravarArquivo({ caminho, conteudo }) {
  const pasta = path.dirname(caminho);
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(caminho, conteudo || '');
  return true;
}

function lerArquivo({ caminho }) {
  return fs.readFileSync(caminho, 'utf8');
}

function apagarCaminho({ caminho }) {
  fs.rmSync(caminho, { recursive: true, force: true });
  return true;
}

function existeCaminho({ caminho }) {
  return fs.existsSync(caminho);
}

function renomearCaminho({ caminho, destino }) {
  fs.renameSync(caminho, destino);
  return true;
}

function copiarArquivo({ caminho, destino }) {
  fs.copyFileSync(caminho, destino);
  return true;
}

const OPERACOES_DE_ARQUIVO = new Map([
  ['read-dir', listarPasta],
  ['create-dir', criarPasta],
  ['write-file', gravarArquivo],
  ['read-file', lerArquivo],
  ['delete', apagarCaminho],
  ['exists', existeCaminho],
  ['rename', renomearCaminho],
  ['copy-file', copiarArquivo],
]);

async function operarNoSistemaDeArquivos(evento, { operation, path: alvo, content, dest }) {
  const caminho = resolverCaminhoDoPedido(alvo);
  const destino = resolverDestinoDoPedido(dest);
  const operacao = OPERACOES_DE_ARQUIVO.get(operation);
  if (!operacao) return undefined;
  return operacao({ caminho: caminhoAbsoluto(caminho), destino: caminhoAbsoluto(destino), conteudo: content });
}

function registrarArquivos({ janela }) {
  ipcMain.handle('dialog:open-file', escolherNaJanelaPrincipal(janela));
  ipcMain.handle('open-media-dialog', escolherUmArquivoNaJanelaPrincipal(janela, FILTRO_DE_MIDIA));
  ipcMain.handle('open-audio-dialog', escolherUmArquivoNaJanelaPrincipal(janela, FILTRO_DE_AUDIO_WAV));
  ipcMain.handle('select-media-file', escolherArquivoDeMidia);
  ipcMain.handle('select-directory', escolherPasta);
  ipcMain.handle('select-multiple-media', escolherVariasMidias);
  ipcMain.handle('open-file', abrirArquivo);
  ipcMain.handle('delete-file', apagarArquivo);
  ipcMain.handle('save-file', salvarVideo);
  ipcMain.handle('system-fs-op', operarNoSistemaDeArquivos);
  ipcMain.handle('system-open', abrirNoSistema);
  ipcMain.handle('save-image', salvarImagem);
  ipcMain.handle('read-file-content', lerConteudoDoArquivo);
  ipcMain.handle('pick-and-read-files', escolherELerAnexos);
}

module.exports = { registrarArquivos };
