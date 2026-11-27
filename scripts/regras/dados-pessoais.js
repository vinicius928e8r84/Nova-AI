'use strict';

const EMAIL = /(?<![\p{L}\p{N}_.%+-])[A-Za-z0-9][A-Za-z0-9._%+-]*@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![\p{L}\p{N}_-])/gu;
const ENDERECOS_SEM_DONO = new Set(['noreply', 'no-reply', 'git']);
const DOMINIOS_SEM_PESSOA = ['example.com', 'example.net', 'example.org', 'exemplo.com', 'exemplo.com.br', 'noreply.github.com', 'c.us', 'g.us', 's.whatsapp.net'];
const FINAIS_RESERVADOS = new Set(['example', 'test', 'invalid', 'localhost']);

const IP = /(?<![\p{L}\p{N}_.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\p{L}\p{N}_]|\.\d)/gu;
const PRIMEIROS_OCTETOS_DE_EXEMPLO = new Set([0, 127, 255]);
const FAIXAS_DE_DOCUMENTACAO = new Set(['192.0.2', '198.51.100', '203.0.113']);
const IPS_NEUTROS = new Set(['1.2.3.4', '5.6.7.8', '8.8.8.8', '9.9.9.9']);

const CAMINHO_NO_WINDOWS = /(?<![A-Za-z])[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}([^\\/\s"'`:]+)/giu;
const CAMINHO_NO_MAC = /(?<![\p{L}\p{N}_:.~$%}-])\/Users\/([^\\/\s"'`:]+)/gu;
const INICIOS_DE_MARCADOR = ['<', '$', '%', '{', '[', '(', '*', '~', '.', '…'];
const PASTAS_GENERICAS = new Set(['public', 'default', 'shared', 'all', 'user', 'username', 'usuario', 'usuário', 'nome', 'name', 'runner', 'runneradmin']);

const dominioDeExemplo = dominio => FINAIS_RESERVADOS.has(dominio.split('.').pop())
  || DOMINIOS_SEM_PESSOA.some(base => dominio === base || dominio.endsWith(`.${base}`));

const pessoal = ([endereco, dominio]) => !ENDERECOS_SEM_DONO.has(endereco.slice(0, endereco.lastIndexOf('@')).toLowerCase())
  && !dominioDeExemplo(dominio.toLowerCase());

const emailsPessoais = linha => [...linha.matchAll(EMAIL)].filter(pessoal).map(achado => achado[0].toLowerCase());

const foraDeEscala = octetos => Math.max(...octetos) > 255;
const EXEMPLOS_DE_IP = [
  octetos => PRIMEIROS_OCTETOS_DE_EXEMPLO.has(octetos[0]),
  octetos => FAIXAS_DE_DOCUMENTACAO.has(octetos.slice(0, 3).join('.')),
  octetos => IPS_NEUTROS.has(octetos.join('.')),
  octetos => octetos.slice(1).every(octeto => octeto === 0),
];
const ipDeExemplo = octetos => EXEMPLOS_DE_IP.some(ehExemplo => ehExemplo(octetos));
const ipReal = achado => {
  const octetos = achado.slice(1).map(Number);
  return !foraDeEscala(octetos) && !ipDeExemplo(octetos);
};
const ipsReais = linha => [...linha.matchAll(IP)].filter(ipReal).map(achado => achado[0]);

const marcador = nome => INICIOS_DE_MARCADOR.some(inicio => nome.startsWith(inicio));
const nomeDePessoa = nome => !marcador(nome) && !PASTAS_GENERICAS.has(nome.toLowerCase());
const caminhosPessoais = linha => [...linha.matchAll(CAMINHO_NO_WINDOWS), ...linha.matchAll(CAMINHO_NO_MAC)]
  .map(achado => achado[1])
  .filter(nomeDePessoa)
  .map(nome => nome.toLowerCase());

const TIPOS = [
  { tipo: 'e-mail', cabe: linha => linha.includes('@'), achar: emailsPessoais },
  { tipo: 'endereço IP', cabe: linha => linha.includes('.'), achar: ipsReais },
  { tipo: 'caminho com o nome de um usuário', cabe: linha => /users/i.test(linha), achar: caminhosPessoais },
];

function tiposDaLinha(linha, nomes) {
  const tipos = TIPOS.filter(item => item.cabe(linha)).map(item => ({ tipo: item.tipo, valores: item.achar(linha) }));
  if (nomes) tipos.push({ tipo: 'nome da lista de nomes proibidos', valores: nomes.achar(linha) });
  return tipos.filter(item => item.valores.length).map(item => item.tipo);
}

module.exports = { tiposDaLinha };
