'use strict';

const CONFIGURACAO = { apiKey: 'chave-de-teste', projectId: 'projeto-de-teste', appId: '1:1:web:abc' };
const CONFIGURACAO_ERRADA = { apiKey: 'chave-velha', projectId: 'nova-license-system', appId: '1:2:web:def' };
const ARMAZENADA = { fb_license_config: JSON.stringify(CONFIGURACAO) };
const COM_SESSAO = { admin_sessao: 'sessao-1' };

const LICENCAS = [
  { id: 'NOVA-AAAA-BBBB-CCCC', dados: { plan: 'pro', status: 'active', machineId: 'HW-1', customerName: "Ana O'Neil", customerMobile: '+55 11 90000-0000', createdAt: { seconds: 1700000000 }, activatedAt: { seconds: 1700100000 } } },
  { id: 'NOVA-DDDD-EEEE-FFFF', dados: { plan: 'basic', status: 'blocked', machineId: '', createdAt: { seconds: 1700200000 } } },
  { id: 'NOVA-GGGG-HHHH-JJJJ', dados: { status: 'active', customerName: 'Barra\\invertida', customerMobile: '—' } },
  { id: 'NOVA-KKKK-LLLL-MMMM', dados: { plan: 'pro', machineId: 'HW-2', createdAt: { seconds: 1700300001 }, activatedAt: { seconds: 1700300000 } } },
  { id: 'NOVA-NNNN-PPPP-QQQQ', dados: { plan: 'enterprise', status: 'suspended', machineId: 'HW-3' } },
];

const ALERTAS = [
  { id: 'alerta-1', dados: { licenseKey: 'NOVA-AAAA-BBBB-CCCC', timestamp: { seconds: 1700400000 }, details: 'Máquina diferente', attemptedMachineId: 'HW-9', boundMachineId: 'HW-1' } },
  { id: 'alerta-2', dados: {} },
];

const ok = corpo => ({ ok: true, corpo });
const recusado = corpo => ({ ok: false, corpo });

async function entrar(palco) {
  await palco.carregar();
  await palco.chamar('showDashboard()');
  await palco.esperar();
}

async function painelComLicencas(palco) {
  await entrar(palco);
  palco.escuta.aoReceber(palco.instantaneo(ALERTAS));
}

async function configuracaoQueMuda(palco) {
  await palco.carregar();
  palco.cena.respostas = { '/api/get-firebase-config': ok({ apiKey: 'so-a-chave' }) };
  await palco.chamar('loadSavedConfig()');
  palco.cena.respostas = { '/api/get-firebase-config': recusado({}) };
  await palco.chamar('loadSavedConfig()');
  palco.cena.respostas = { '/api/get-firebase-config': { falha: 'JSON ruim' } };
  await palco.chamar('loadSavedConfig()');
}

async function tokenDoCelular(palco) {
  await palco.carregar();
  palco.localStorage.itens.set('nova_token', '{');
  await palco.chamar('loadSavedConfig()');
  palco.localStorage.itens.set('nova_token', JSON.stringify({}));
  await palco.chamar('loadSavedConfig()');
}

async function sessaoGuardada(palco) {
  await palco.carregar();
  palco.cena.respostas = { '/api/admin-sessao': recusado({}) };
  await palco.chamar('restaurarSessaoDoAdmin()');
  palco.sessionStorage.itens.set('admin_sessao', 'sessao-2');
  palco.cena.respostas = {};
  await palco.chamar('restaurarSessaoDoAdmin()');
  await palco.chamar('restaurarSessaoDoAdmin()');
}

async function senhaDoAdministrador(palco) {
  await palco.carregar();
  palco.preencher('passcode-input', { value: 'codigo-certo' });
  await palco.chamar('attemptAuthentication()');
  palco.cena.respostas = { '/api/admin-login': recusado({ error: 'Muitas tentativas' }) };
  palco.preencher('passcode-input', { value: 'errado' });
  await palco.chamar('attemptAuthentication()');
  palco.cena.respostas = { '/api/admin-login': recusado({}) };
  await palco.chamar('attemptAuthentication()');
  palco.cena.respostas = {};
  await palco.chamar('attemptAuthentication()');
}

async function teclasNoCampoDaSenha(palco) {
  await palco.carregar();
  palco.disparar('passcode-input', 'keydown', { key: 'a' });
  palco.disparar('passcode-input', 'keydown', { key: 'Enter' });
  await palco.esperar();
}

async function registroVazioEConsultaQueFalha(palco) {
  await palco.chamar('loadLicenses()');
  await entrar(palco);
  palco.cena.falhaNaConsulta = 'permissão negada';
  await palco.chamar('loadLicenses()');
}

async function acoesSobreALicenca(palco) {
  await entrar(palco);
  await palco.chamar("clearMachine('NOVA-AAAA-BBBB-CCCC')");
  await palco.chamar("toggleBlock('NOVA-AAAA-BBBB-CCCC', 'active')");
  await palco.chamar("toggleBlock('NOVA-DDDD-EEEE-FFFF', 'blocked')");
  await palco.chamar("deleteKey('NOVA-DDDD-EEEE-FFFF')");
  palco.cena.confirma = false;
  await palco.chamar("clearMachine('NOVA-AAAA-BBBB-CCCC')");
  await palco.chamar("deleteKey('NOVA-DDDD-EEEE-FFFF')");
}

async function acoesQueOBancoRecusa(palco) {
  await entrar(palco);
  palco.cena.falhaNoBanco = 'sem permissão';
  await palco.chamar("clearMachine('NOVA-AAAA-BBBB-CCCC')");
  await palco.chamar("toggleBlock('NOVA-AAAA-BBBB-CCCC', 'active')");
  await palco.chamar("deleteKey('NOVA-AAAA-BBBB-CCCC')");
  await palco.chamar("editCustomer('NOVA-AAAA-BBBB-CCCC', 'Ana', '1')");
}

async function editarOCliente(palco) {
  await entrar(palco);
  await palco.chamar("editCustomer('NOVA-AAAA-BBBB-CCCC', 'Ana', '1')");
  await palco.chamar("editCustomer('NOVA-AAAA-BBBB-CCCC', 'Ana', '1')");
  await palco.chamar("editCustomer('NOVA-GGGG-HHHH-JJJJ', '—', '—')");
  await palco.chamar("editCustomer('NOVA-GGGG-HHHH-JJJJ', '—', '—')");
}

async function gerarChaves(palco) {
  await palco.chamar('generateLicense()');
  await entrar(palco);
  palco.preencher('gen-name', { value: '  Cliente Novo  ' });
  palco.preencher('gen-mobile', { value: ' 11 97777-6666 ' });
  await palco.chamar('generateLicense()');
  palco.preencher('gen-plan', { value: 'basic' });
  palco.preencher('gen-qty', { value: '5' });
  await palco.chamar('generateLicense()');
  palco.cena.falhaNoBanco = 'cota esgotada';
  await palco.chamar('generateLicense()');
}

async function copiarAChave(palco) {
  palco.preencher('gen-key-txt', { innerText: 'NOVA-TESTE-1234-ABCD' });
  await palco.chamar('copyGeneratedKey()');
  await palco.esperar();
  palco.cena.areaDeTransferenciaNegada = true;
  await palco.chamar('copyGeneratedKey()');
}

async function janelasEAviso(palco) {
  for (const chamada of ['openFirebaseModal()', 'closeFirebaseModal()', 'openAlertsModal()', 'closeAlertsModal()', 'closeToast()']) await palco.chamar(chamada);
}

async function alertasDeSeguranca(palco) {
  await entrar(palco);
  palco.escuta.aoReceber(palco.instantaneo([]));
  palco.escuta.aoReceber(palco.instantaneo(ALERTAS.slice(0, 1)));
  palco.escuta.aoReceber(palco.instantaneo(ALERTAS));
  await palco.chamar("deleteAlert('alerta-1')");
  palco.cena.confirma = false;
  await palco.chamar("deleteAlert('alerta-2')");
  palco.cena.confirma = true;
  palco.cena.falhaNoBanco = 'sem permissão';
  await palco.chamar("deleteAlert('alerta-2')");
  palco.escuta.aoFalhar(new Error('escuta caiu'));
}

async function bloquearOPainel(palco) {
  await entrar(palco);
  await palco.chamar('initAlertsListener()');
  await palco.chamar('terminateSession()');
  await palco.chamar('terminateSession()');
  palco.cena.respostas = {};
  await palco.chamar('terminateSession()');
}

async function ajustesDoBanco(palco) {
  palco.preencher('fb-apikey', { value: '  chave-nova  ' });
  palco.preencher('fb-projectid', { value: '   ' });
  palco.preencher('fb-appid', { value: ' 1:9:web:zzz ' });
  await palco.chamar('saveFirebaseSettings()');
  palco.preencher('fb-projectid', { value: ' projeto-novo ' });
  await palco.chamar('saveFirebaseSettings()');
  palco.cena.respostas = {};
  await palco.chamar('saveFirebaseSettings()');
}

async function bancoQueNaoInicia(palco) {
  await palco.chamar('initFirebase()');
  palco.localStorage.itens.set('fb_license_config', JSON.stringify(CONFIGURACAO));
  palco.cena.falhaNaInicializacao = 'chave inválida';
  await palco.chamar('initFirebase()');
  palco.cena.falhaNaInicializacao = null;
  await palco.chamar('initFirebase()');
  await palco.chamar('initFirebase()');
}

async function semOSdkDoFirebase(palco) {
  await entrar(palco);
  await palco.chamar('loadLicenses()');
  await palco.chamar('initAlertsListener()');
  await palco.chamar('generateLicense()');
}

const LISTA = [
  { nome: 'abertura sem nada guardado cria a configuração padrão', acao: palco => palco.carregar() },
  {
    nome: 'abertura com o projeto errado guardado troca pela configuração do servidor',
    armazenado: { fb_license_config: JSON.stringify(CONFIGURACAO_ERRADA) },
    respostas: { '/api/get-firebase-config': ok(CONFIGURACAO) },
    acao: palco => palco.carregar(),
  },
  {
    nome: 'configuração do servidor diferente com o banco já iniciado recarrega a página',
    armazenado: ARMAZENADA,
    sessao: COM_SESSAO,
    respostas: { '/api/admin-sessao': ok({}), '/api/get-firebase-config': ok({ ...CONFIGURACAO, appId: '1:3:web:ghi' }) },
    acao: palco => palco.carregar(),
  },
  {
    nome: 'configuração do servidor igual, incompleta ou recusada não muda nada',
    armazenado: ARMAZENADA,
    respostas: { '/api/get-firebase-config': ok(CONFIGURACAO) },
    acao: configuracaoQueMuda,
  },
  {
    nome: 'configuração guardada quebrada e token do celular para o servidor',
    armazenado: { fb_license_config: '{', nova_token: JSON.stringify({ token: 'tk-1' }) },
    respostas: { '/api/get-firebase-config': ok({}) },
    acao: tokenDoCelular,
  },
  {
    nome: 'sessão guardada aceita, recusada e com o servidor fora',
    sessao: COM_SESSAO,
    armazenado: ARMAZENADA,
    respostas: { '/api/admin-sessao': ok({}) },
    acao: sessaoGuardada,
  },
  {
    nome: 'senha do administrador: certa, errada com e sem mensagem e servidor fora',
    armazenado: ARMAZENADA,
    respostas: { '/api/admin-login': ok({ sessao: 'sessao-nova' }), '/api/get-firebase-config': ok(CONFIGURACAO) },
    acao: senhaDoAdministrador,
  },
  {
    nome: 'tecla Enter no campo da senha tenta entrar e outra tecla não',
    armazenado: ARMAZENADA,
    respostas: { '/api/admin-login': recusado({ error: 'Acesso Negado' }) },
    acao: teclasNoCampoDaSenha,
  },
  { nome: 'abertura sem o campo da senha', sem: ['passcode-input'], armazenado: ARMAZENADA, acao: palco => palco.carregar() },
  { nome: 'painel mostra as licenças, os números e os alertas', armazenado: ARMAZENADA, licencas: LICENCAS, acao: painelComLicencas },
  { nome: 'painel com registro vazio, com consulta que falha e sem o banco iniciado', armazenado: ARMAZENADA, licencas: [], acao: registroVazioEConsultaQueFalha },
  { nome: 'ações sobre a licença: limpar a máquina, bloquear, ativar e excluir', armazenado: ARMAZENADA, licencas: LICENCAS, acao: acoesSobreALicenca },
  { nome: 'ações sobre a licença que o banco recusa mostram o erro', armazenado: ARMAZENADA, licencas: LICENCAS, acao: acoesQueOBancoRecusa },
  {
    nome: 'editar o cliente: cancelar em cada pergunta, limpar os traços e salvar',
    armazenado: ARMAZENADA,
    licencas: LICENCAS,
    digitado: [null, '  Novo Nome  ', null, '—', '  +55 11 98888-7777  ', '  Outro  ', ''],
    acao: editarOCliente,
  },
  { nome: 'gerar chaves: sem banco, uma, cinco e com o banco recusando', armazenado: ARMAZENADA, licencas: [], acao: gerarChaves },
  { nome: 'copiar a chave gerada: copia e a área de transferência negada', acao: copiarAChave },
  { nome: 'janelas e aviso abrem e fecham', acao: janelasEAviso },
  { nome: 'alertas de segurança: vazio, um, vários e descartar', armazenado: ARMAZENADA, licencas: [], acao: alertasDeSeguranca },
  {
    nome: 'bloquear o painel encerra a sessão e a escuta dos alertas',
    armazenado: ARMAZENADA,
    sessao: COM_SESSAO,
    licencas: [],
    respostas: { '/api/admin-logout': ok({}) },
    acao: bloquearOPainel,
  },
  {
    nome: 'ajustes do banco de dados: campos vazios, salvar e servidor fora',
    armazenado: { ...ARMAZENADA, nova_token: JSON.stringify({ token: 'tk-1' }) },
    respostas: { '/api/save-firebase-config': ok({}) },
    acao: ajustesDoBanco,
  },
  { nome: 'registro com o nome que não é texto mostra a falha da consulta', armazenado: ARMAZENADA, licencas: [{ id: 'NOVA-1', dados: { customerName: 123 } }], acao: entrar },
  { nome: 'registro só com o celular que não é texto mostra a falha da consulta', armazenado: ARMAZENADA, licencas: [{ id: 'NOVA-2', dados: { customerMobile: 5511 } }], acao: entrar },
  { nome: 'o SDK do Firebase não carregou: o painel mostra o erro e segue sem banco', armazenado: ARMAZENADA, semFirebase: true, acao: semOSdkDoFirebase },
  { nome: 'o banco não inicia: sem configuração guardada e com a inicialização falhando', licencas: [], acao: bancoQueNaoInicia },
];

module.exports = { cenas: Object.fromEntries(LISTA.map(cena => [cena.nome, cena])) };
