'use strict';

const FALHAS_LIVRES = 5;
const ESPERA_BASE_MS = 30 * 1000;
const ESPERA_MAXIMA_MS = 15 * 60 * 1000;
const ESQUECER_APOS_MS = 60 * 60 * 1000;
const CLIENTES_MAXIMOS = 10000;

const ENDERECOS_LOCAIS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

class LimiteDeTentativas {
    constructor({ agora = Date.now } = {}) {
        this.agora = agora;
        this.clientes = new Map();
    }

    bloqueado(cliente) {
        const registro = this.clientes.get(cliente);
        return Boolean(registro) && registro.bloqueadoAte > this.agora();
    }

    registrarFalha(cliente) {
        const agora = this.agora();
        const registro = this.registroVigente(cliente, agora);
        registro.falhas += 1;
        registro.ultimaFalha = agora;
        if (registro.falhas > FALHAS_LIVRES) {
            const espera = ESPERA_BASE_MS * 2 ** (registro.falhas - FALHAS_LIVRES - 1);
            registro.bloqueadoAte = agora + Math.min(espera, ESPERA_MAXIMA_MS);
        }
        this.clientes.delete(cliente);
        this.clientes.set(cliente, registro);
        this.podar(agora);
    }

    registroVigente(cliente, agora) {
        const registro = this.clientes.get(cliente);
        const envelhecido = !registro || agora - registro.ultimaFalha > ESQUECER_APOS_MS;
        return envelhecido ? { falhas: 0, bloqueadoAte: 0 } : registro;
    }

    registrarSucesso(cliente) {
        this.clientes.delete(cliente);
    }

    podar(agora) {
        if (this.clientes.size <= CLIENTES_MAXIMOS) return;
        this.esquecerAntigos(agora);
        this.esquecerMaisAntigosAteCaber();
    }

    esquecerAntigos(agora) {
        for (const [cliente, registro] of this.clientes) {
            if (agora - registro.ultimaFalha > ESQUECER_APOS_MS) this.clientes.delete(cliente);
        }
    }

    esquecerMaisAntigosAteCaber() {
        const excedente = this.clientes.size - CLIENTES_MAXIMOS;
        [...this.clientes.keys()].slice(0, Math.max(excedente, 0)).forEach((cliente) => this.clientes.delete(cliente));
    }
}

function clienteDaConexao(enderecoDoPar, cabecalhos = {}, tunelAtivo = false) {
    const doTunel = tunelAtivo && ENDERECOS_LOCAIS.has(enderecoDoPar) ? cabecalhos['cf-connecting-ip'] : null;
    return String(doTunel || enderecoDoPar || 'desconhecido').trim();
}

module.exports = { LimiteDeTentativas, clienteDaConexao, FALHAS_LIVRES };
