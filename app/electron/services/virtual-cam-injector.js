const GlobalSpoofService = require('./global-spoof-service');

class VirtualCamInjector {
    constructor(mainWindow, app, browserFarmService) {
        this.mainWindow = mainWindow;
        this.app = app;
        this.browserFarmService = browserFarmService;

        this.globalSpoof = new GlobalSpoofService(mainWindow, app, browserFarmService);

        Object.defineProperty(this, 'isHijacking', {
            get: () => this.globalSpoof.isHijacking,
        });

        console.log('[VirtualCamInjector] Initialized → delegating to GlobalSpoofService.');
    }

    async detectDriver() {
        return this.globalSpoof.detectDriver();
    }

    async startHijack(buffer, settings) {
        return this.globalSpoof.startHijack(buffer, settings);
    }

    async stopHijack() {
        return this.globalSpoof.stopHijack();
    }

    async installDriver() {
        return this.globalSpoof.installOBSVirtualCam();
    }

    getStatus() {
        return this.globalSpoof.getStatus();
    }

    updateStatus() {
        this.globalSpoof._emitStatus();
    }

    writeChunk(buffer) {
        if (this.globalSpoof.writeChunk) {
            this.globalSpoof.writeChunk(buffer);
        }
    }
}

module.exports = VirtualCamInjector;
