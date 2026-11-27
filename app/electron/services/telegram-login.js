const { Api } = require('telegram');
const qrcode = require('qrcode');

async function enviarCodigo(gerente, { phone, apiId, apiHash }) {
    await gerente.cleanupPendingLogin();
    gerente.ensureRuntimeDirectories();
    gerente.setStatus('connecting');
    try {
        const client = gerente.criarCliente('', { apiId, apiHash });

        await client.connect();

        const res = await client.sendCode({
            apiId: parseInt(apiId),
            apiHash: apiHash
        }, phone);

        gerente.pendingLogin = {
            client,
            phone,
            phoneCodeHash: res.phoneCodeHash,
            apiId,
            apiHash
        };

        gerente.setStatus('wait_code');
        return { success: true };
    } catch (err) {
        console.error('[Telegram] Failed sending OTP:', err);
        gerente.setStatus('disconnected', { reason: err.message });
        return { success: false, error: err.message };
    }
}

async function iniciarLoginPorQr(gerente, { apiId, apiHash }) {
    await gerente.cleanupPendingLogin();
    gerente.ensureRuntimeDirectories();
    gerente.setStatus('connecting');
    try {
        const client = gerente.criarCliente('', { apiId, apiHash });

        await client.connect();

        gerente.pendingLogin = {
            client,
            apiId,
            apiHash
        };

        client.signInUserWithQrCode({ apiId: parseInt(apiId), apiHash }, etapasDoLoginPorQr(gerente))
            .then(() => concluirLoginPorQr(gerente, client, { apiId, apiHash }))
            .catch(err => {
                console.error("[Telegram] QR code login failed/aborted:", err.message);
                gerente.setStatus('disconnected', { reason: err.message });
            });

        return { success: true };
    } catch (err) {
        console.error('[Telegram] Failed initiating QR login:', err);
        gerente.setStatus('disconnected', { reason: err.message });
        return { success: false, error: err.message };
    }
}

function etapasDoLoginPorQr(gerente) {
    return {
        onError: async (err) => falhaNoLoginPorQr(gerente, err),
        qrCode: async (qrToken) => mostrarQrCode(gerente, qrToken),
        password: async () => esperarSenhaDoLoginPorQr(gerente)
    };
}

function falhaNoLoginPorQr(gerente, err) {
    console.error("[Telegram] QR Code Login error:", err.message);
    gerente.setStatus('disconnected', { reason: err.message });
    return true;
}

async function mostrarQrCode(gerente, qrToken) {
    const tokenString = qrToken.token.toString("base64url");
    const link = `tg://login?token=${tokenString}`;
    try {
        const qrDataUrl = await qrcode.toDataURL(link);
        gerente.qrCodeUrl = qrDataUrl;
        gerente.setStatus('wait_qr', { qrUrl: qrDataUrl });
    } catch (err) {
        console.error("[Telegram] QR generation failed:", err);
        gerente.qrCodeUrl = link;
        gerente.setStatus('wait_qr', { qrUrl: link });
    }
}

function esperarSenhaDoLoginPorQr(gerente) {
    gerente.setStatus('wait_password');
    return new Promise((resolve) => {
        gerente.passwordResolver = resolve;
    });
}

async function concluirLoginPorQr(gerente, client, credenciais) {
    gerente.passwordResolver = null;
    gerente.ativarCliente(client);
    await gerente.concluirLogin('Logged in via QR Code as', credenciais);
}

async function confirmarCodigo(gerente, { code }) {
    if (!gerente.pendingLogin) return { success: false, error: 'No login flow active' };
    const login = gerente.pendingLogin;

    try {
        const entrou = await entrarComCodigo(login, code);
        if (!entrou) {
            gerente.setStatus('wait_password');
            return { success: true, requiresPassword: true };
        }
        gerente.ativarCliente(login.client);
        await gerente.concluirLogin('Logged in as', login);
        return { success: true, authenticated: true };
    } catch (err) {
        console.error('[Telegram] OTP verification failed:', err);
        return { success: false, error: err.message };
    }
}

async function entrarComCodigo({ client, phone, phoneCodeHash }, code) {
    try {
        const signInResult = await client.invoke(
            new Api.auth.SignIn({
                phoneNumber: phone,
                phoneCodeHash: phoneCodeHash,
                phoneCode: code
            })
        );
        if (signInResult instanceof Api.auth.AuthorizationSignUpRequired) {
            throw new Error('SIGN_UP_REQUIRED: This phone number is not registered on Telegram. Please register it using the official app first.');
        }
        return true;
    } catch (err) {
        if (err.message.includes('SESSION_PASSWORD_NEEDED')) return false;
        throw err;
    }
}

async function confirmarSenha(gerente, { password }) {
    if (!gerente.pendingLogin) return { success: false, error: 'No login flow active' };
    if (gerente.passwordResolver) return entregarSenhaAoLoginPorQr(gerente, password);
    const login = gerente.pendingLogin;

    try {
        await login.client.signInWithPassword(
            {
                apiId: parseInt(login.apiId),
                apiHash: login.apiHash
            },
            {
                password: () => password,
                onError: (err) => {
                    console.error('[Telegram] 2FA Password error callback:', err);
                    return true;
                }
            }
        );
        gerente.ativarCliente(login.client);
        await gerente.concluirLogin('Logged in as (2FA)', login);
        return { success: true, authenticated: true };
    } catch (err) {
        console.error('[Telegram] 2FA authentication failed:', err);
        return { success: false, error: err.message };
    }
}

function entregarSenhaAoLoginPorQr(gerente, password) {
    gerente.passwordResolver(password);
    gerente.passwordResolver = null;
    return { success: true, authenticated: true };
}

module.exports = { enviarCodigo, iniciarLoginPorQr, confirmarCodigo, confirmarSenha };
