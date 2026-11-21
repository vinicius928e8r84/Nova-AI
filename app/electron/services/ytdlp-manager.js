const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const ytSearch = require('yt-search');
const toolPaths = require('./tool-paths');

class YtDlpManager {
    constructor(mainWindow, app) {
        this.mainWindow = mainWindow;
        this.app = app;
        this.defaultSavePath = path.resolve(os.homedir(), 'Downloads', 'Nova Downloads');
        
        if (!fs.existsSync(this.defaultSavePath)) {
            fs.mkdirSync(this.defaultSavePath, { recursive: true });
        }
        
        // State variables
        this.activeProcess = null;
        this.activeDetails = null; // { title, format, type, url, targetChatId }
        this.awaitingConfirmation = false;
        this.pendingDownloadArgs = null; // { searchQuery, format, type, targetChatId }
    }

    getYtDlpPath() {
        const candidates = [
            path.join(process.resourcesPath, 'bin', toolPaths.exe('yt-dlp')),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'bin', toolPaths.exe('yt-dlp')),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin', toolPaths.exe('yt-dlp')),
            path.join(this.app ? this.app.getAppPath() : process.cwd(), 'resources', 'bin', toolPaths.exe('yt-dlp')),
            path.join(this.app ? this.app.getAppPath() : process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', toolPaths.exe('yt-dlp')),
            path.join(process.cwd(), 'resources', 'bin', toolPaths.exe('yt-dlp')),
            path.join(process.cwd(), 'dist_electron', 'win-unpacked', 'resources', 'bin', toolPaths.exe('yt-dlp'))
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) return p;
        }
        return 'yt-dlp';
    }

    getFfmpegDir() {
        const candidates = [
            path.join(process.resourcesPath, 'bin'),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'bin'),
            path.join(this.app ? this.app.getAppPath() : process.cwd(), 'resources', 'bin'),
            path.join(process.cwd(), 'resources', 'bin'),
            path.join(process.cwd(), 'dist_electron', 'win-unpacked', 'resources', 'bin')
        ];
        for (const p of candidates) {
            if (fs.existsSync(path.join(p, toolPaths.exe('ffmpeg')))) return p;
        }
        return path.join(process.resourcesPath, 'bin');
    }

    sendToFrontend(event, data) {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        try {
            this.mainWindow.webContents.send(event, data);
        } catch (error) {
            console.error('[YTDLP-Smart] IPC Send error:', error);
        }
    }

    sendSwarmLog(text) {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        try {
            const ts = new Date().toLocaleTimeString([], { hour12: false });
            const line = `[${ts}] DOWNLOADER → ${text}`;
            this.mainWindow.webContents.send('swarm:log', { agent: 'downloader', text: line });
        } catch (error) {}
    }

    sendSwarmStatus(status, progress) {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        try {
            this.mainWindow.webContents.send('swarm:status', { agentId: 'downloader', status, progress });
        } catch (error) {}
    }

    getWhatsappManager() {
        return require('../main').whatsappManager;
    }

    sendWhatsappReply(chatId, message) {
        try {
            if (this.app.whatsappManager) {
                this.app.whatsappManager.sendReply(chatId, message);
            }
        } catch(e) { console.error('Failed sending WA message', e); }
    }

    async smartDownload(searchQuery, format, type, targetChatId) {
        console.log(`[YTDLP-Smart] Received Request: Query="${searchQuery}", Format=${format}, Type=${type}`);
        
        // Check Queue State
        if (this.activeProcess || this.awaitingConfirmation) {
            console.log('[YTDLP-Smart] A download is already running.');
            this.awaitingConfirmation = true;
            this.pendingDownloadArgs = { searchQuery, format, type, targetChatId };
            const m = `⚠️ Ek download already chal raha hai (Title: ${this.activeDetails?.title || 'Unknown'}). Rokun aur naya shuru karun? (haan/nahi)`;
            this.sendWhatsappReply(targetChatId, m);
            this.sendToFrontend('ytdl-progress', { status: 'ERROR', error: "Download busy. Waiting for confirmation." });
            this.sendSwarmLog('Waiting for user confirmation...');
            this.sendSwarmStatus('waiting');
            return;
        }

        await this.executePipeline(searchQuery, format, type, targetChatId);
    }

    async handleConfirmation(userResponse) {
        if (!this.awaitingConfirmation) return false;

        const response = (userResponse || '').toLowerCase().trim();
        const { searchQuery, format, type, targetChatId } = this.pendingDownloadArgs;

        if (response === 'haan' || response === 'yes') {
            this.sendWhatsappReply(targetChatId, '🛑 Current download stopped. Starting new request...');
            if (this.activeProcess) {
                try { this.activeProcess.kill(); } catch (e) {}
                this.activeProcess = null;
            }
            this.awaitingConfirmation = false;
            this.pendingDownloadArgs = null;
            
            // Start the new one
            await this.executePipeline(searchQuery, format, type, targetChatId);
            return true;
        } 
        else if (response === 'nahi' || response === 'no') {
            this.sendWhatsappReply(targetChatId, '⏳ Naya request queue mein daal diya hai. Current load complete hone ke baad check karein.');
            this.awaitingConfirmation = false;
            this.pendingDownloadArgs = null;
            this.sendToFrontend('ytdl-progress', { status: 'DOWNLOADING', title: this.activeDetails?.title });
            return true;
        }

        return false;
    }

    async manualDownload(url, format, type) {
        console.log(`[YTDLP-Manual] Received: URL=${url}, Format=${format}, Type=${type}`);
        
        if (this.activeProcess) {
            try { this.activeProcess.kill(); } catch(e) {}
            this.activeProcess = null;
        }

        if (!fs.existsSync(this.defaultSavePath)) {
            fs.mkdirSync(this.defaultSavePath, { recursive: true });
        }

        const savePathTemplate = path.resolve(this.defaultSavePath, '%(title)s.%(ext)s');
        const ytDlpPath = this.getYtDlpPath();
        const ffmpegDir = this.getFfmpegDir();

        const args = [
            '--newline',
            '--no-check-certificate',
            '--no-warnings',
            '--prefer-free-formats',
            '--retries', '5',
            '--fragment-retries', '5',
            '--windows-filenames',
            '--yes-playlist',
            '-o', savePathTemplate
        ];

        // Format rules
        if (format === '360p') {
            args.push('-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]/best[height<=360]/best', '--merge-output-format', 'mp4');
        } else if (format === '720p') {
            args.push('-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best', '--merge-output-format', 'mp4');
        } else if (format === '1080p') {
            args.push('-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best', '--merge-output-format', 'mp4');
        } else {
            args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
        }

        if (fs.existsSync(path.join(ffmpegDir, toolPaths.exe('ffmpeg')))) {
            args.push('--ffmpeg-location', ffmpegDir);
        }

        args.push(url);

        console.log(`[YTDLP-Manual] Spawning: ${ytDlpPath} with args:`, args);

        this.sendToFrontend('manual-ytdl-progress', { 
            status: 'DOWNLOADING', 
            progress: 0, 
            speed: '', 
            eta: '', 
            title: 'Initializing download...'
        });

        let stderrLog = '';
        this.activeProcess = spawn(ytDlpPath, args);

        this.activeProcess.stdout.on('data', (data) => {
            const text = data.toString();
            const percentMatch = text.match(/\[download\]\s+(\d+\.?\d*)%/i) || text.match(/(\d+\.?\d*)%/);
            const speedMatch = text.match(/at\s+([0-9.]+[a-zA-Z]+\/s)/i);
            const etaMatch = text.match(/ETA\s+([0-9:]+)/i);
            const sizeMatch = text.match(/of\s+([0-9.]+[a-zA-Z]+)/i);
            const destMatch = text.match(/Destination:\s*(.+)$/m) || text.match(/\[download\]\s+(.+?)\s+has already been/i);

            let extractedTitle = undefined;
            if (destMatch && destMatch[1]) {
                extractedTitle = path.basename(destMatch[1].trim());
            }

            if (percentMatch) {
                this.sendToFrontend('manual-ytdl-progress', { 
                    status: 'DOWNLOADING', 
                    progress: parseFloat(percentMatch[1]), 
                    speed: speedMatch ? speedMatch[1] : '', 
                    eta: etaMatch ? etaMatch[1] : '',
                    size: sizeMatch ? sizeMatch[1] : '',
                    title: extractedTitle
                });
            } else if (text.toLowerCase().includes('already been downloaded')) {
                this.sendToFrontend('manual-ytdl-progress', { 
                    status: 'COMPLETE',
                    progress: 100,
                    title: extractedTitle || 'File already downloaded'
                });
            }
        });

        this.activeProcess.stderr.on('data', (data) => {
            const text = data.toString();
            console.warn(`[YTDLP-Manual-Stderr]: ${text}`);
            stderrLog += text + '\n';
        });

        this.activeProcess.on('close', (code) => {
            console.log(`[YTDLP-Manual] Exit code ${code}`);
            this.activeProcess = null;
            if (code === 0) {
                this.sendToFrontend('manual-ytdl-progress', { status: 'COMPLETE', progress: 100 });
            } else {
                let errorMsg = 'Download failed or was interrupted.';
                if (stderrLog.trim().length > 0) {
                    const lines = stderrLog.trim().split('\n').filter(l => !l.startsWith('WARNING:'));
                    errorMsg = lines[lines.length - 1] || errorMsg;
                }
                this.sendToFrontend('manual-ytdl-progress', { status: 'ERROR', error: `Exit Code ${code}: ${errorMsg}` });
            }
        });

        this.activeProcess.on('error', (err) => {
            console.error('[YTDLP-Manual] Error:', err);
            this.sendToFrontend('manual-ytdl-progress', { status: 'ERROR', error: err.message });
            this.activeProcess = null;
        });
    }

    cancelManualDownload() {
        if (this.activeProcess) {
            try { this.activeProcess.kill(); } catch (e) {}
            this.activeProcess = null;
            this.sendToFrontend('manual-ytdl-progress', { status: 'ERROR', error: 'Download Canceled by User' });
            return true;
        }
        return false;
    }

    async executePipeline(searchQuery, format, type, targetChatId) {
        this.activeDetails = { query: searchQuery, format, type, targetChatId, title: 'Searching...' };
        
        this.sendSwarmStatus('busy', 0);
        this.sendSwarmLog(`🔍 Initializing search sequence...`);

        // 1. WhatsApp Search Start
        this.sendWhatsappReply(targetChatId, `🔍 Searching YouTube for: "${searchQuery}"...`);
        this.sendToFrontend('ytdl-progress', { 
            status: 'SEARCHING', 
            query: searchQuery, 
            message: 'Procurando no YouTube...' 
        });

        // 2. yt-search Phase
        this.sendSwarmLog(`🌐 Querying YouTube databanks: "${searchQuery}"`);
        let url = '';
        let title = '';
        let totalCount = 1;
        try {
            if (type === 'playlist') {
                const searchRes = await ytSearch(searchQuery + ' full playlist');
                if (!searchRes || !searchRes.playlists || searchRes.playlists.length === 0) {
                    throw new Error('No playlist found.');
                }
                const pl = searchRes.playlists[0];
                url = pl.url;
                title = pl.title;
                totalCount = pl.videoCount || 1;
            } else {
                const searchRes = await ytSearch(searchQuery);
                if (!searchRes || !searchRes.videos || searchRes.videos.length === 0) {
                    throw new Error('No video found.');
                }
                const vid = searchRes.videos[0];
                url = vid.url;
                title = vid.title;
            }
        } catch (e) {
            console.error('[YTDLP-Smart] Search failed:', e.message);
            this.sendWhatsappReply(targetChatId, `❌ YouTube par koi result nahi mila: ${searchQuery}`);
            this.sendToFrontend('ytdl-progress', { status: 'ERROR', error: `No results found for: ${searchQuery}` });
            this.sendSwarmLog(`❌ Search failed: No results`);
            this.sendSwarmStatus('idle', 0);
            this.activeDetails = null;
            return; // Normal state wapas
        }

        this.activeDetails.url = url;
        this.activeDetails.title = title;

        // Found message
        this.sendSwarmLog(`✅ Found Target: ${title.substring(0, 45)}...`);
        this.sendWhatsappReply(targetChatId, `✅ Found: ${title}\nFormat: ${format}\nType: ${type}\nStarting download...`);

        if (type === 'playlist' && totalCount > 50) {
            this.sendWhatsappReply(targetChatId, `⚠️ Playlist mein ${totalCount} videos hain. Pehle 50 download ho rahe hain.`);
        }

        // Generate arguments based on user exact instructions
        const savePathTemplate = path.resolve(this.defaultSavePath, '%(title)s.%(ext)s');
        
        const ytDlpPath = this.getYtDlpPath();
        const ffmpegDir = this.getFfmpegDir();

        const args = [
            '--newline',
            '--no-check-certificate',
            '--no-warnings',
            '--prefer-free-formats',
            '--retries', '5',
            '--fragment-retries', '5',
            '--windows-filenames',
            '--yes-playlist',
            '--max-downloads', '50',
            '-o', savePathTemplate
        ];

        if (format === '360p') {
            args.push('-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]/best[height<=360]/best', '--merge-output-format', 'mp4');
        } else if (format === '720p') {
            args.push('-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best', '--merge-output-format', 'mp4');
        } else if (format === '1080p') {
            args.push('-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best', '--merge-output-format', 'mp4');
        } else {
            args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
        }

        if (fs.existsSync(path.join(ffmpegDir, toolPaths.exe('ffmpeg')))) {
            args.push('--ffmpeg-location', ffmpegDir);
        }

        args.push(url);

        console.log(`[YTDLP-Smart] Spawning: ${ytDlpPath} with args:`, args);

        // State variables for parsing loop
        let currentItemIndex = 1;
        let lastNotifiedPercentage = 0;
        let currentItemTitle = title;
        let currentPercentage = 0;

        this.sendToFrontend('ytdl-progress', { 
            status: 'DOWNLOADING', 
            title: title + (type === 'playlist' ? ' [Playlist]' : ''), 
            format, 
            progress: 0, 
            speed: 'Calculating...', 
            eta: 'Calculating...', 
            fileCount: `${currentItemIndex} / ${Math.min(totalCount, 50)}`
        });

        this.activeProcess = spawn(ytDlpPath, args);

        // Parse stdout
        this.activeProcess.stdout.on('data', (data) => {
            const text = data.toString();
            
            if (text.toLowerCase().includes('already been downloaded') || text.toLowerCase().includes('has already been downloaded')) {
                let skipTitle = currentItemTitle;
                const fileMatch = text.match(/\[download\] (.*?) has already been/);
                if(fileMatch) skipTitle = path.basename(fileMatch[1]);
                this.sendWhatsappReply(targetChatId, `⏭️ ${skipTitle} already downloaded hai — skip kiya.`);
                return;
            }

            const percentMatch = text.match(/\[download\]\s+(\d+\.?\d*)%/);
            const speedMatch = text.match(/at\s+([0-9.]+[a-zA-Z]+\/s)/);
            const etaMatch = text.match(/ETA\s+([0-9:]+)/);

            if (percentMatch) {
                currentPercentage = parseFloat(percentMatch[1]);
                let speedRaw = speedMatch ? speedMatch[1] : '';
                let etaRaw = etaMatch ? etaMatch[1] : '';

                this.sendToFrontend('ytdl-progress', { 
                    status: 'DOWNLOADING', 
                    title: title + (type === 'playlist' ? ' [Playlist]' : ''), 
                    format, 
                    progress: currentPercentage, 
                    speed: speedRaw, 
                    eta: etaRaw, 
                    fileCount: `${currentItemIndex} / ${Math.min(totalCount, 50)}`
                });
                
                this.sendSwarmStatus('busy', currentPercentage);
                
                // Throttle swarm logs for progress to mostly just major milestones (every 10%)
                if (currentPercentage >= lastNotifiedPercentage + 10) {
                     lastNotifiedPercentage = Math.floor(currentPercentage / 10) * 10;
                     this.sendSwarmLog(`⬇ Downloading... ${currentPercentage}% (${speedRaw})`);
                }

                if (type === 'playlist') {
                    if (currentPercentage >= 25 && lastNotifiedPercentage < 25) { 
                        lastNotifiedPercentage = 25; 
                        this.sendWhatsappReply(targetChatId, `⬇️ Downloading... 25% complete\n${currentItemIndex} / ${Math.min(totalCount, 50)} videos done`);
                    } else if (currentPercentage >= 50 && lastNotifiedPercentage < 50) { 
                        lastNotifiedPercentage = 50; 
                        this.sendWhatsappReply(targetChatId, `⬇️ Downloading... 50% complete\n${currentItemIndex} / ${Math.min(totalCount, 50)} videos done`);
                    } else if (currentPercentage >= 75 && lastNotifiedPercentage < 75) { 
                        lastNotifiedPercentage = 75; 
                        this.sendWhatsappReply(targetChatId, `⬇️ Downloading... 75% complete\n${currentItemIndex} / ${Math.min(totalCount, 50)} videos done`);
                    }
                }
            }

            if (text.includes('[download] 100%') || text.includes('100% of')) {
                this.sendSwarmLog(`✅ File Extracted.`);
                currentItemIndex++;
                lastNotifiedPercentage = 0; 
            }
        });

        this.activeProcess.stderr.on('data', (data) => {
            console.warn(`[YTDLP-Smart-Stderr]: ${data.toString()}`);
        });

        this.activeProcess.on('close', (code) => {
            console.log(`[YTDLP-Smart] child process exited with code ${code}`);
            
            this.sendToFrontend('ytdl-progress', { 
                status: 'COMPLETE', 
                title: title, 
                format,
                fileCount: `${Math.min(totalCount, 50)}`,
                saveLocation: 'Nova Downloads'
            });
            this.sendWhatsappReply(targetChatId, `✅ Download Complete!\nTitle: ${title}\nSaved in: Nova Downloads folder`);
            
            this.sendSwarmLog(`✅ Download Sequence Complete.`);
            this.sendSwarmStatus('done');
            setTimeout(() => { if (!this.activeProcess) this.sendSwarmStatus('idle'); }, 2000);
            
            this.activeProcess = null;
            this.activeDetails = null;
        });

        this.activeProcess.on('error', (err) => {
            console.error('[YTDLP-Smart] Child Process Spawn Error:', err);
            this.sendWhatsappReply(targetChatId, `❌ Download failed: Unable to spawn yt-dlp.\nKoi aur command do ya retry karo`);
            this.sendToFrontend('ytdl-progress', { status: 'ERROR', error: err.message });
            this.sendSwarmLog(`❌ Download Error: ${err.message}`);
            this.sendSwarmStatus('idle');
            this.activeProcess = null;
            this.activeDetails = null;
        });
    }
}

module.exports = YtDlpManager;
