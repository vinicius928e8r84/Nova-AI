if (typeof marked === 'undefined') {
    window.marked = { parse: (text) => text.replace(/\n/g, '<br>') };
}
class NovaRemoteApp {
    constructor() {
        this.socket = null;
        this.token = null;
        this.isConnected = false;

        this.messageInput = document.getElementById('message-input');
        this.modelSelect = document.getElementById('model-select');
        this.tokenInput = document.getElementById('token-input');
        this.thinkingIndicator = document.getElementById('ai-thinking');
        this.activeModelName = document.getElementById('active-model-name');
        this.messagesContainer = document.getElementById('messages');
        this.micBtn = document.getElementById('mic-btn');

        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.groqKey = null;

        this.init();
    }

    init() {
        this.loadSavedToken();
        this.setupEventListeners();
        this.checkURLParams();
    }

    loadSavedToken() {
        const saved = localStorage.getItem('nova_token');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.token = data.token;
                if (this.tokenInput) this.tokenInput.value = this.token;
            } catch (e) {
                console.error('Failed to load saved token:', e);
            }
        }
    }

    checkURLParams() {
        const params = new URLSearchParams(window.location.search);
        const urlToken = params.get('token');

        if (urlToken) {
            this.token = urlToken;
            if (this.tokenInput) this.tokenInput.value = urlToken;
            this.showError('QR escaneado com sucesso! Sincronizando...');
            setTimeout(() => this.connect(), 800);
        }
    }

    setupEventListeners() {
        const connectBtn = document.getElementById('connect-btn');
        if (connectBtn) connectBtn.addEventListener('click', () => this.connect());

        if (this.tokenInput) {
            this.tokenInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.connect();
            });
        }

        const disconnectBtn = document.getElementById('disconnect-btn');
        if (disconnectBtn) disconnectBtn.addEventListener('click', () => this.disconnect());

        const sendBtn = document.getElementById('send-btn');
        if (sendBtn) sendBtn.addEventListener('click', () => this.sendMessage());

        if (this.messageInput) {
            this.messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });

            this.messageInput.addEventListener('input', (e) => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
            });
        }

        if (this.micBtn) {
            this.micBtn.addEventListener('click', () => this.handleMicClick());
        }

        if (this.modelSelect) {
            this.modelSelect.addEventListener('change', () => {
                const selectedText = this.modelSelect.options[this.modelSelect.selectedIndex].text;
                if (this.activeModelName) this.activeModelName.textContent = selectedText.split(' ').pop();
                this.switchModel(this.modelSelect.value);
            });
        }
    }

    async connect() {
        const tokenVal = this.tokenInput ? this.tokenInput.value.trim() : '';
        if (!tokenVal) {
            this.showError('Por favor, digite o token de acesso');
            return;
        }

        this.token = tokenVal;
        this.setConnecting(true);

        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        try {
            const serverUrl = window.location.origin;
            this.socket = io(serverUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionDelay: 2000,
                reconnectionAttempts: 5,
                timeout: 10000
            });

            this.setupSocketHandlers();

            this._connectTimer = setTimeout(() => {
                if (!this.isConnected) {
                    this.showError('Tempo de conexão esgotado. Verifique se o Nova está rodando no seu computador.');
                    this.setConnecting(false);
                }
            }, 12000);

            this.socket.on('connect', () => {
                console.log('[Socket] Connected, authenticating...');
                this.socket.emit('authenticate', { token: this.token });
            });

            this.socket.on('connect_error', (err) => {
                console.error('[Socket] Connection error:', err.message);
                this.showError('Não foi possível alcançar o Nova no computador. Verifique se o Nova está aberto. Erro: ' + err.message);
                this.setConnecting(false);
            });

        } catch (error) {
            this.showError('Falha na ponte: ' + error.message);
            this.setConnecting(false);
        }
    }

    setupSocketHandlers() {
        this.socket.on('authenticated', (data) => {
            if (this._connectTimer) clearTimeout(this._connectTimer);
            if (data.success) {
                this.onAuthenticated();
            } else {
                this.showError(data.bloqueado ? data.error : 'Token inválido. Pegue o token correto em Ajustes do Nova → aba Link Móvel.');
                this.setConnecting(false);
            }
        });

        this.socket.on('ai-response', (data) => {
            this.setThinking(false);
            this.addMessage('ai', data.message, data.timestamp);
        });

        this.socket.on('ai-thinking', () => {
            this.setThinking(true);
        });

        this.socket.on('groq-key', (data) => {
            this.groqKey = data.apiKey;
            console.log('[Groq] Key synchronized');
        });

        this.socket.on('token-revoked', () => {
            alert('Sessão revogada pelo host.');
            this.disconnect();
        });

        this.socket.on('server-shutdown', () => {
            this.showError('O computador do Nova está offline. Reconectando quando disponível...');
            this.updateConnectionStatus(false);
        });

        this.socket.on('disconnect', (reason) => {
            console.log('[Socket] Disconnected:', reason);
            if (this.isConnected) {
                this.updateConnectionStatus(false);
            }
        });

        this.socket.on('reconnect', () => {
            console.log('[Socket] Reconnected, re-authenticating...');
            if (this.token) {
                this.socket.emit('authenticate', { token: this.token });
            }
        });

        this.socket.on('connect', () => {
            if (this.isConnected && this.token) {
                this.socket.emit('authenticate', { token: this.token });
            }
        });
    }

    onAuthenticated() {
        localStorage.setItem('nova_token', JSON.stringify({
            token: this.token,
            savedAt: Date.now()
        }));

        this.isConnected = true;
        this.setConnecting(false);
        this.switchScreen('chat');
        this.updateConnectionStatus(true);

        const authError = document.getElementById('auth-error');
        if (authError) authError.style.display = 'none';

        if (this.modelSelect && this.activeModelName) {
            const selectedText = this.modelSelect.options[this.modelSelect.selectedIndex].text;
            this.activeModelName.textContent = selectedText.split(' ').pop();
            this.switchModel(this.modelSelect.value);
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.switchScreen('auth');
        this.clearMessages();
    }

    switchModel(modelName) {
        if (this.socket && this.socket.connected) {
            this.socket.emit('switch-model', { model: modelName });
        }
    }

    sendMessage() {
        if (!this.messageInput) return;
        const message = this.messageInput.value.trim();
        if (!message || !this.isConnected) return;

        this.addMessage('user', message);
        this.socket.emit('chat-message', {
            message,
            timestamp: Date.now()
        });

        this.messageInput.value = '';
        this.messageInput.style.height = 'auto';
        this.setThinking(true);
    }

    async handleMicClick() {
        console.log('[Mic] Click registered');
        if (!this.isConnected) {
            this.showError('Por favor, conecte-se primeiro');
            return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            const msg = 'Microfone não suportado neste navegador. Chrome/Safari exigem HTTPS para acesso ao microfone. Use a URL do Túnel Cloudflare.';
            alert(msg);
            this.showError(msg);
            return;
        }

        if (!this.isRecording) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.mediaRecorder = new MediaRecorder(stream);
                this.audioChunks = [];

                this.mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) this.audioChunks.push(e.data);
                };

                this.mediaRecorder.onstop = async () => {
                    const audioBlob = new Blob(this.audioChunks, { type: 'audio/m4a' });
                    await this.processTranscription(audioBlob);
                    stream.getTracks().forEach(track => track.stop());
                };

                this.mediaRecorder.start();
                this.isRecording = true;
                this.micBtn.classList.add('recording');
            } catch (err) {
                console.error("Recording start fail:", err);
                this.showError('Acesso ao microfone negado');
            }
        } else {
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            this.isRecording = false;
            this.micBtn.classList.remove('recording');
        }
    }

    async processTranscription(blob) {
        if (!this.groqKey) {
            this.socket.emit('get-groq-key');
            await new Promise(r => setTimeout(r, 1000));
            if (!this.groqKey) {
                this.showError('Chave do Groq não disponível');
                return;
            }
        }

        this.setThinking(true);
        if (this.thinkingIndicator) this.thinkingIndicator.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span> Transcrevendo...';

        try {
            const formData = new FormData();
            formData.append('file', blob, 'audio.m4a');
            formData.append('model', 'whisper-large-v3');
            formData.append('response_format', 'verbose_json');

            const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.groqKey}` },
                body: formData
            });

            const result = await response.json();
            if (result.text) {
                this.messageInput.value = result.text;
                this.messageInput.style.height = 'auto';
                this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 150) + 'px';
                this.messageInput.focus();
            }
        } catch (err) {
            console.error("Transcription error:", err);
            this.showError('Falha na transcrição');
        } finally {
            this.setThinking(false);
            if (this.thinkingIndicator) this.thinkingIndicator.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span> Nova está analisando...';
        }
    }

    addMessage(sender, text, timestamp) {
        if (!this.messagesContainer) return;
        if (!text) return;

        const welcomeMsg = this.messagesContainer.querySelector('.centered-hint');
        if (welcomeMsg) welcomeMsg.remove();

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;

        let content;
        try {
            content = sender === 'ai' ? marked.parse(text) : `<p>${this.escapeHtml(text)}</p>`;
        } catch (e) {
            content = `<p>${this.escapeHtml(text)}</p>`;
        }

        messageDiv.innerHTML = `
            <span class="message-label">${sender === 'user' ? 'Você' : 'Nova'}</span>
            <div class="message-bubble">${content}</div>
        `;

        this.messagesContainer.appendChild(messageDiv);

        setTimeout(() => this.scrollToBottom(), 50);
    }

    setThinking(status) {
        if (this.thinkingIndicator) {
            this.thinkingIndicator.style.display = status ? 'flex' : 'none';
            if (status) this.scrollToBottom();
        }
    }

    clearMessages() {
        if (!this.messagesContainer) return;
        this.messagesContainer.innerHTML = `
            <div class="centered-hint">
                <div class="hint-icon"><img src="/logo.png" width="32"></div>
                <h3>Terminal Ativo</h3>
                <p>Sessão remota segura estabelecida.</p>
            </div>
        `;
    }

    scrollToBottom() {
        if (!this.messagesContainer) return;
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    switchScreen(screenName) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(`${screenName}-screen`).classList.add('active');
    }

    setConnecting(isConnecting) {
        const btn = document.getElementById('connect-btn');
        if (!btn) return;
        const btnText = btn.querySelector('.btn-text');
        const btnLoader = btn.querySelector('.btn-loader');

        btn.disabled = isConnecting;
        if (btnText) btnText.style.display = isConnecting ? 'none' : 'inline';
        if (btnLoader) btnLoader.style.display = isConnecting ? 'block' : 'none';
    }

    updateConnectionStatus(isOnline) {
        const statusText = document.getElementById('connection-status');
        if (statusText) {
            statusText.innerHTML = isOnline ?
                '<span class="pulse-dot"></span> Ativo' :
                '<span class="pulse-dot" style="background: var(--error)"></span> Offline';
        }
    }

    showError(message) {
        const errorDiv = document.getElementById('auth-error');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            setTimeout(() => { errorDiv.style.display = 'none'; }, 5000);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.app = new NovaRemoteApp();
    });
} else {
    window.app = new NovaRemoteApp();
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW registration failed:', err));
}
