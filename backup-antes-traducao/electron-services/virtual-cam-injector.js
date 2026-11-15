/**
 * VirtualCamInjector — Delegation bridge to GlobalSpoofService
 * 
 * This class is kept for IPC backwards-compatibility.
 * All real injection logic now lives in GlobalSpoofService.
 */

const GlobalSpoofService = require('./global-spoof-service');

class VirtualCamInjector {
    constructor(mainWindow, app, browserFarmService) {
        this.mainWindow = mainWindow;
        this.app = app;
        this.browserFarmService = browserFarmService;

        // Delegate all logic to the GlobalSpoofService
        this.globalSpoof = new GlobalSpoofService(mainWindow, app, browserFarmService);

        // Expose key state for legacy IPC checks
        Object.defineProperty(this, 'isHijacking', {
            get: () => this.globalSpoof.isHijacking,
        });

        console.log('[VirtualCamInjector] Initialized → delegating to GlobalSpoofService.');
    }

    /** Detect available drivers */
    async detectDriver() {
        return this.globalSpoof.detectDriver();
    }

    /** Start hijack via best available injection layer */
    async startHijack(buffer, settings) {
        return this.globalSpoof.startHijack(buffer, settings);
    }

    /** Stop hijack and restore physical webcam */
    async stopHijack() {
        return this.globalSpoof.stopHijack();
    }

    /** Install OBS VirtualCam silently */
    async installDriver() {
        return this.globalSpoof.installOBSVirtualCam();
    }

    /** Get current status object */
    getStatus() {
        return this.globalSpoof.getStatus();
    }

    /** Legacy status broadcast (kept for app.js compat) */
    updateStatus() {
        this.globalSpoof._emitStatus();
    }

    /** Pass buffer chunks to global spoof service */
    writeChunk(buffer) {
        if (this.globalSpoof.writeChunk) {
            this.globalSpoof.writeChunk(buffer);
        }
    }
}

module.exports = VirtualCamInjector;
