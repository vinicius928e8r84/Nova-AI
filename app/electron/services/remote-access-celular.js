const path = require('path');
const fs = require('fs');

const SALA_AUTENTICADOS = 'autenticados';
const RESULTADO_VALIDO = 'valido';
const RESULTADO_INVALIDO = 'invalido';
const RESULTADO_BLOQUEADO = 'bloqueado';
const RECUSAS_DO_SOCKET = {
    [RESULTADO_INVALIDO]: { success: false, error: 'Invalid token' },
    [RESULTADO_BLOQUEADO]: { success: false, bloqueado: true, error: 'Muitas tentativas. Aguarde e tente de novo.' }
};

function receberCelular(servico, socket) {
    console.info(`[RemoteAccess] New connection attempt: ${socket.id}`);
    socket.on('authenticate', (carga) => autenticarSocket(servico, socket, carga));
    socket.on('chat-message', (data) => encaminharMensagem(servico, socket, data));
    socket.on('switch-model', (data) => encaminharTrocaDeModelo(servico, socket, data));
    socket.on('disconnect', () => desligarCelular(servico, socket));
    socket.on('get-groq-key', () => enviarChaveDoGroq(servico, socket));
}

function autenticarSocket(servico, socket, carga) {
    const cliente = servico.clienteDaConexao(socket.handshake.address, socket.handshake.headers);
    const resultado = servico.conferirCliente(cliente, () => servico.validateToken(carga?.token));
    if (resultado === RESULTADO_VALIDO) return aceitarSocket(servico, socket, carga.token);
    socket.emit('authenticated', RECUSAS_DO_SOCKET[resultado]);
    socket.disconnect();
}

function aceitarSocket(servico, socket, token) {
    const tokenData = servico.tokens.get(token);
    servico.connectedClients.set(socket.id, {
        token,
        deviceName: tokenData.deviceName,
        connectedAt: Date.now()
    });

    confirmarAutenticacao(socket);
    console.info(`[RemoteAccess] Client authenticated: ${tokenData.deviceName}`);

    servico.notifyDesktop('client-connected', {
        deviceName: tokenData.deviceName,
        socketId: socket.id
    });

    enviarChaveDoGroq(servico, socket);
}

async function encaminharMensagem(servico, socket, data) {
    const cliente = servico.connectedClients.get(socket.id);
    if (!cliente) {
        socket.emit('error', { message: 'Não autenticado' });
        return;
    }
    console.info(`[RemoteAccess] Message from ${cliente.deviceName}:`, data.message);
    servico.notifyDesktop('mobile-message', {
        message: data.message,
        attachments: data.attachments,
        socketId: socket.id,
        deviceName: cliente.deviceName
    });
}

function encaminharTrocaDeModelo(servico, socket, data) {
    const cliente = servico.connectedClients.get(socket.id);
    if (!cliente) return;
    console.info(`[RemoteAccess] Model switch request from ${cliente.deviceName}:`, data.model);
    servico.notifyDesktop('model-select', { model: data.model, socketId: socket.id });
}

function desligarCelular(servico, socket) {
    const cliente = servico.connectedClients.get(socket.id);
    if (!cliente) return;
    console.info(`[RemoteAccess] Client disconnected: ${cliente.deviceName}`);
    servico.connectedClients.delete(socket.id);
    servico.notifyDesktop('client-disconnected', { deviceName: cliente.deviceName, socketId: socket.id });
}

function enviarChaveDoGroq(servico, socket) {
    if (!servico.connectedClients.has(socket.id)) return;
    const groqKeyPath = path.join(servico.app.getPath('userData'), 'groq_key.json');
    try {
        if (fs.existsSync(groqKeyPath)) {
            const data = JSON.parse(fs.readFileSync(groqKeyPath, 'utf8'));
            if (data.apiKey) {
                socket.emit('groq-key', { apiKey: data.apiKey });
                return;
            }
        }
        if (process.env.GROQ_API_KEY) {
            socket.emit('groq-key', { apiKey: process.env.GROQ_API_KEY });
        }
    } catch (e) {
        console.error('[RemoteAccess] Error reading Groq key:', e);
    }
}

function confirmarAutenticacao(socket) {
    socket.join(SALA_AUTENTICADOS);
    socket.emit('authenticated', { success: true });
}

module.exports = { SALA_AUTENTICADOS, RESULTADO_VALIDO, RESULTADO_INVALIDO, RESULTADO_BLOQUEADO, receberCelular };
