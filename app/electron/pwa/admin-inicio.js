function descartarConfiguracaoDoProjetoErrado() {
    const storedConfig = localStorage.getItem('fb_license_config');
    if (!storedConfig) return;
    try {
        const parsed = JSON.parse(storedConfig);
        if (parsed.projectId === 'nova-license-system') {
            localStorage.removeItem('fb_license_config');
        }
    } catch(e) {}
}

function ligarTeclaEnterDaSenha() {
    const passcodeInput = document.getElementById('passcode-input');
    if (passcodeInput) {
        passcodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') globalThis.attemptAuthentication();
        });
    }
}

window.addEventListener('load', () => {
    descartarConfiguracaoDoProjetoErrado();
    globalThis.restaurarSessaoDoAdmin();
    globalThis.loadSavedConfig();
    ligarTeclaEnterDaSenha();
});
