const NodeMediaServer = require('node-media-server');
const { spawn, exec } = require('child_process');
const path = require('path');
const { PassThrough } = require('stream');
const fs = require('fs');

let nms = null;
let ffmpegProcess = null;
let videoStream = null;

const config = {
  bind: '127.0.0.1',
  rtmp: {
    port: 11935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  }
};

function startRtmpServer() {
  if (nms) return;
  try {
      nms = new NodeMediaServer(config);
      nms.run();
      console.log('[RTMP] Node Media Server started on port 11935 (1935 é do MediaMTX neste Mac)');
  } catch (err) {
      console.error('[RTMP] Error starting server:', err);
  }
}

function stopRtmpServer() {
  if (nms) {
    nms.stop();
    nms = null;
    console.log('[RTMP] Node Media Server stopped');
  }
}

async function startBroadcast() {
    if (ffmpegProcess) {
        await stopBroadcast();
    }
    
    // Auto-forward port 1935 to the phone in case it was restarted or reconnected
    exec('adb reverse tcp:1935 tcp:11935', (err) => {
        if (err) {
            console.log('[RTMP-ADB] ADB reverse setup skipped/failed (normal if no device connected or WiFi mode):', err.message);
        } else {
            console.log('[RTMP-ADB] ADB reverse forwarding 1935(android)->11935(mac) established successfully.');
        }
    });

    videoStream = new PassThrough();
    
    // Check if ffmpeg exists in resources/bin
    let ffmpegPath = (process.platform === 'darwin')
        ? require('./mac-native').tool('ffmpeg')
        : path.join(process.cwd(), 'resources', 'bin', 'ffmpeg.exe');
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
        ffmpegPath = 'ffmpeg';
    }
    
    // We expect webm via stdin
    const args = [
        '-y',
        '-i', 'pipe:0', 
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-b:v', '2500k',
        '-maxrate', '3000k',
        '-bufsize', '3000k',
        '-g', '30',
        '-keyint_min', '30',
        '-f', 'flv',
        'rtmp://127.0.0.1:11935/live/nova'
    ];

    console.log('[RTMP] Starting FFmpeg broadcaster stream to rtmp://127.0.0.1:11935/live/nova');
    ffmpegProcess = spawn(ffmpegPath, args);

    videoStream.pipe(ffmpegProcess.stdin);

    ffmpegProcess.stderr.on('data', (data) => {
        // Safe stream logging without hardcoded paths
        // console.log('[FFMPEG RTMP]', data.toString().trim());
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`[FFMPEG RTMP] Process exited with code ${code}`);
        ffmpegProcess = null;
    });

    return true;
}

function stopBroadcast() {
    return new Promise((resolve) => {
        if (videoStream) {
            videoStream.end();
            videoStream = null;
        }
        if (!ffmpegProcess) {
            return resolve(true);
        }
        
        const pid = ffmpegProcess.pid;
        let resolved = false;
        
        const cleanup = () => {
            if (!resolved) {
                resolved = true;
                ffmpegProcess = null;
                console.log('[RTMP] Stopped FFmpeg broadcaster stream');
                resolve(true);
            }
        };

        ffmpegProcess.once('close', cleanup);
        ffmpegProcess.once('exit', cleanup);

        if (process.platform === 'win32') {
            try {
                exec(`taskkill /F /PID ${pid}`, (err) => {
                    if (err) {
                        console.warn(`[RTMP] taskkill failed for PID ${pid}, falling back to kill()`);
                        if (ffmpegProcess) ffmpegProcess.kill('SIGKILL');
                    }
                });
            } catch (e) {
                if (ffmpegProcess) ffmpegProcess.kill('SIGKILL');
            }
        } else {
            ffmpegProcess.kill('SIGKILL');
        }

        // Safety timeout (1s) to prevent hanging if events are missed
        setTimeout(cleanup, 1000);
    });
}

function receiveVideoChunk(buffer) {
    if (videoStream) {
        videoStream.write(Buffer.from(buffer));
    }
}

module.exports = {
    startRtmpServer,
    stopRtmpServer,
    startBroadcast,
    stopBroadcast,
    receiveVideoChunk
};
