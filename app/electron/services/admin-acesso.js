'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VARIAVEL_DO_CODIGO = 'NOVA_ADMIN_CODE';
const ARQUIVO_DO_CODIGO = 'admin_code.json';
const BYTES_DA_SESSAO = 32;
const DURACAO_DA_SESSAO_MS = 12 * 60 * 60 * 1000;
const SESSOES_MAXIMAS = 50;
const TAMANHO_MAXIMO_DO_CORPO = 1024;
const TAMANHO_MAXIMO_DO_CODIGO = 256;
const CABECALHO_DA_SESSAO = 'x-admin-sessao';
const CABECALHOS_DA_RESPOSTA = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const ROTAS = new Map([
    ['/api/admin-login', 'POST'],
    ['/api/admin-sessao', 'GET'],
    ['/api/admin-logout', 'POST']
]);

const misturar = (codigo, sal) => crypto.scryptSync(String(codigo), sal, 32);

function referenciaDoCodigo(codigo) {
    const sal = crypto.randomBytes(16);
    return { sal, hash: misturar(codigo, sal) };
}

function referenciaDoArquivo(caminho) {
    try {
        const { sal, hash } = JSON.parse(fs.readFileSync(caminho, 'utf8'));
        const referencia = { sal: Buffer.from(sal, 'hex'), hash: Buffer.from(hash, 'hex') };
        return referencia.sal.length > 0 && referencia.hash.length === 32 ? referencia : null;
    } catch (e) {
        return null;
    }
}

function gravarCodigo(pasta, codigo) {
    const sal = crypto.randomBytes(16);
    const conteudo = { sal: sal.toString('hex'), hash: misturar(codigo, sal).toString('hex') };
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(path.join(pasta, ARQUIVO_DO_CODIGO), JSON.stringify(conteudo, null, 2), { mode: 0o600 });
}

function gerarCodigo() {
    return crypto.randomBytes(12).toString('base64url');
}

const codigoPlausivel = codigo => typeof codigo === 'string' && codigo.length > 0 && codigo.length <= TAMANHO_MAXIMO_DO_CODIGO;

class VerificadorDoCodigo {
    constructor({ pasta, ambiente = process.env }) {
        this.pasta = pasta;
        this.ambiente = ambiente;
    }

    referencia() {
        const doAmbiente = this.ambiente[VARIAVEL_DO_CODIGO];
        if (doAmbiente) return referenciaDoCodigo(doAmbiente);
        return referenciaDoArquivo(path.join(this.pasta, ARQUIVO_DO_CODIGO));
    }

    configurado() {
        return this.referencia() !== null;
    }

    confere(codigo) {
        const referencia = this.referencia();
        if (!referencia || !codigoPlausivel(codigo)) return false;
        return crypto.timingSafeEqual(misturar(codigo, referencia.sal), referencia.hash);
    }
}

class SessoesDoAdmin {
    constructor({ agora = Date.now } = {}) {
        this.agora = agora;
        this.validadeDe = new Map();
    }

    abrir() {
        this.esquecerVencidas();
        while (this.validadeDe.size >= SESSOES_MAXIMAS) this.validadeDe.delete(this.validadeDe.keys().next().value);
        const sessao = crypto.randomBytes(BYTES_DA_SESSAO).toString('hex');
        this.validadeDe.set(sessao, this.agora() + DURACAO_DA_SESSAO_MS);
        return sessao;
    }

    valida(sessao) {
        return typeof sessao === 'string' && (this.validadeDe.get(sessao) ?? 0) > this.agora();
    }

    encerrar(sessao) {
        this.validadeDe.delete(sessao);
    }

    esquecerVencidas() {
        for (const [sessao, validade] of this.validadeDe) {
            if (validade <= this.agora()) this.validadeDe.delete(sessao);
        }
    }
}

function responder(res, status, corpo) {
    res.writeHead(status, CABECALHOS_DA_RESPOSTA);
    res.end(JSON.stringify(corpo));
}

function lerCorpoJson(req, aoLer) {
    let corpo = '';
    let estourou = false;
    req.on('data', pedaco => {
        corpo += pedaco;
        if (corpo.length > TAMANHO_MAXIMO_DO_CORPO) estourou = true;
    });
    req.on('end', () => {
        try {
            aoLer(estourou ? {} : JSON.parse(corpo || '{}'));
        } catch (e) {
            aoLer({});
        }
    });
}

class AcessoDoAdmin {
    constructor({ pasta, conferirCliente, ambiente, agora }) {
        this.verificador = new VerificadorDoCodigo({ pasta, ambiente });
        this.sessoes = new SessoesDoAdmin({ agora });
        this.conferirCliente = conferirCliente;
    }

    ehRota(req) {
        return ROTAS.get(req.url) === req.method;
    }

    atender(req, res, cliente) {
        if (req.url === '/api/admin-sessao') this.responderSessao(req, res);
        else if (req.url === '/api/admin-logout') this.encerrarSessao(req, res);
        else lerCorpoJson(req, corpo => this.entrar(res, cliente, corpo.codigo));
    }

    sessaoDaRequisicao(req) {
        return req.headers[CABECALHO_DA_SESSAO];
    }

    responderSessao(req, res) {
        if (this.sessoes.valida(this.sessaoDaRequisicao(req))) responder(res, 200, { valida: true });
        else responder(res, 401, { valida: false });
    }

    encerrarSessao(req, res) {
        this.sessoes.encerrar(this.sessaoDaRequisicao(req));
        responder(res, 200, { success: true });
    }

    entrar(res, cliente, codigo) {
        if (!this.verificador.configurado()) {
            responder(res, 503, { error: 'Código do painel não configurado neste computador.' });
            return;
        }
        const resultado = this.conferirCliente(cliente, () => this.verificador.confere(codigo));
        if (resultado === 'valido') responder(res, 200, { sessao: this.sessoes.abrir() });
        else if (resultado === 'bloqueado') responder(res, 429, { error: 'Muitas tentativas. Aguarde e tente de novo.' });
        else responder(res, 401, { error: 'Acesso negado' });
    }
}

module.exports = {
    AcessoDoAdmin,
    SessoesDoAdmin,
    VerificadorDoCodigo,
    gerarCodigo,
    gravarCodigo,
    ARQUIVO_DO_CODIGO,
    VARIAVEL_DO_CODIGO
};
