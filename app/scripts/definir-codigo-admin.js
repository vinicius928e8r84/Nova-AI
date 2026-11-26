'use strict';

const os = require('os');
const path = require('path');
const { gerarCodigo, gravarCodigo, ARQUIVO_DO_CODIGO } = require('../electron/services/admin-acesso');

const NOME_DA_PASTA_DO_APP = 'nova_dsktp';

function pastaDosDadosDoApp() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', NOME_DA_PASTA_DO_APP);
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), NOME_DA_PASTA_DO_APP);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), NOME_DA_PASTA_DO_APP);
}

function definirCodigoDoAdmin(pasta) {
  const codigo = gerarCodigo();
  gravarCodigo(pasta, codigo);
  return codigo;
}

if (require.main === module) {
  const pasta = process.argv[2] || pastaDosDadosDoApp();
  const codigo = definirCodigoDoAdmin(pasta);
  console.log(`Código novo do painel admin (anote agora, ele não é mostrado de novo):\n\n  ${codigo}\n`);
  console.log(`Só o resumo irreversível foi gravado em ${path.join(pasta, ARQUIVO_DO_CODIGO)}.`);
  console.log('Reinicie o Nova para o painel usar o código novo; o código antigo deixa de valer.');
}

module.exports = { definirCodigoDoAdmin, pastaDosDadosDoApp };
