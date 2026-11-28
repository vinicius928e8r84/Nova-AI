'use strict';
const { executar, comando, abrirTunelDoAparelho, garantirTunelDoAparelho, conectarPorSsh, criarClienteSsh } = require('./setup-ssh');
const { lerImpressoesConhecidas, gravarImpressao, prepararChaveLocal, confiarNoAparelho } = require('./setup-chaves');
const { instalarPacotesDoNova, catvncInstalado, versaoDoHelperDeFuso, esperarHelperDeFuso } = require('./setup-pacotes');

const LETRAS_MAXIMAS_DA_SENHA = 1024;
const UDID_ACEITO = /^[a-fA-F0-9-]{20,64}$/;
const QUEBRA_OU_NULO = /[\r\n\0]/;
const COMANDO_DO_JAILBREAK_E_SUDO = 'test -d /var/jb && command -v sudo >/dev/null';
const AVISO_SEM_TUNEL = 'O túnel USB não abriu (porta 2222). Reconecte o iPhone, confira se o jailbreak está ativo e tente de novo.';
const MENSAGEM_DO_CATVNC = 'CatVNC encontrado. A tela ao vivo usa a senha configurada em Ajustes → CatVNC.';
const MENSAGEM_SEM_CATVNC = 'Para tela e controle por toque, instale e configure o CatVNC pelo Sileo. O Nova não inclui esse pacote.';

let ocupado = false;

const REGRAS_DA_SENHA = [
  (senha) => typeof senha === 'string' && senha !== '',
  (senha) => senha.length <= LETRAS_MAXIMAS_DA_SENHA,
  (senha) => !QUEBRA_OU_NULO.test(senha),
];

function exigirSenhaValida(senha) {
  if (!REGRAS_DA_SENHA.every((regra) => regra(senha))) throw new Error('Informe uma senha SSH válida.');
}

async function escolherAparelho(id) {
  require('../tool-paths').exigirOpenssh('ssh');
  const udid = id.slice(4);
  if (!UDID_ACEITO.test(udid)) throw new Error('Identificador do iPhone inválido.');
  const ligados = (await executar(require('../ios-tools').tool('idevice_id'), ['-l'])).split('\n').filter(Boolean);
  if (ligados.length !== 1 || ligados[0] !== udid) throw new Error('Conecte somente o iPhone selecionado por USB.');
  return udid;
}

async function lerModeloEVersao(udid) {
  const ferramenta = require('../ios-tools').tool('ideviceinfo');
  const modelo = await executar(ferramenta, ['-u', udid, '-k', 'ProductType']);
  const versao = await executar(ferramenta, ['-u', udid, '-k', 'ProductVersion']);
  return { modelo, versao };
}

async function abrirSessaoSsh({ cliente, senha, udid, conhecidas }) {
  if (!(await garantirTunelDoAparelho())) throw new Error(AVISO_SEM_TUNEL);
  const impressao = await conectarPorSsh(cliente, senha, conhecidas.impressoes, udid);
  await comando(cliente, COMANDO_DO_JAILBREAK_E_SUDO);
  gravarImpressao(conhecidas, udid, impressao);
  return impressao;
}

async function exigirAcessoPorChave(servico) {
  const validacao = await servico.iosSsh('test -d /var/jb');
  if (!validacao.ok) throw new Error('Senha aceita, mas a chave de acesso não foi validada. Verifique conflitos de chave SSH neste computador.');
}

function mensagemFinal(resumoDosPacotes, temCatvnc) {
  const dicaDoCatvnc = temCatvnc ? MENSAGEM_DO_CATVNC : MENSAGEM_SEM_CATVNC;
  return 'Conectado por USB. Acesso SSH configurado; a senha não foi salva.\n\n' + resumoDosPacotes + '\n\n' + dicaDoCatvnc + '\n\nAs funções disponíveis dependem do suporte a iOS de cada aba.';
}

async function prepararAparelho(sessao) {
  const { cliente, senha, servico, udid } = sessao;
  const impressao = await abrirSessaoSsh(sessao);
  const chaveLocal = await prepararChaveLocal();
  await confiarNoAparelho(cliente, impressao, chaveLocal);
  await exigirAcessoPorChave(servico);
  const resumo = await instalarPacotesDoNova(cliente, senha, await lerModeloEVersao(udid));
  return { success: true, message: mensagemFinal(resumo, await catvncInstalado(cliente)) };
}

async function prepare(id, password, service) {
  if (ocupado) throw new Error('Já existe uma preparação em andamento.');
  exigirSenhaValida(password);
  ocupado = true;
  let cliente;
  try {
    const udid = await escolherAparelho(id);
    await abrirTunelDoAparelho(udid);
    const conhecidas = lerImpressoesConhecidas(service);
    cliente = criarClienteSsh();
    return await prepararAparelho({ cliente, senha: password, servico: service, udid, conhecidas });
  } finally {
    password = '';
    if (cliente) cliente.end();
    ocupado = false;
  }
}

function prompt(win, payload) {
  if (!win || win.isDestroyed()) return { success: false, error: 'A janela do Nova não está disponível.' };
  const data = { id: String((payload && payload.id) || ''), name: String((payload && payload.name) || '') };
  if (!data.id) return { success: false, error: 'Selecione um iPhone conectado.' };
  win.webContents.send('nova:iphone-setup-open', data);
  return { success: true, message: 'Informe a senha SSH no quadro do Nova.' };
}

module.exports = { prepare, prompt, __test: { localeHelperVersion: versaoDoHelperDeFuso, waitLocaleHandshake: esperarHelperDeFuso } };
