const NodeMediaServer = require('node-media-server');
const { spawn, exec, execFile } = require('child_process');
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

function encaminharPortaAdb(adbPath, executar = execFile) {
    executar(adbPath && fs.existsSync(adbPath) ? adbPath : 'adb', ['reverse', 'tcp:1935', 'tcp:11935'], { windowsHide: true }, (err) => {
        if (err) console.warn('[RTMP-ADB] adb reverse não feito (normal sem aparelho ou em Wi-Fi):', err.message);
    });
}

async function startBroadcast(adbPath) {
    if (ffmpegProcess) {
        await stopBroadcast();
    }
    
    encaminharPortaAdb(adbPath);

    videoStream = new PassThrough();
    
    let ffmpegPath = require('./tool-paths').ffmpeg();
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
        ffmpegPath = 'ffmpeg';
    }
    
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
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`[FFMPEG RTMP] Process exited with code ${code}`);
        ffmpegProcess = null;
    });

    return true;
}

function fecharEntradaDeVideo() {
    if (videoStream) {
        videoStream.end();
        videoStream = null;
    }
}

function matarFfmpegSeAindaExiste() {
    if (ffmpegProcess) ffmpegProcess.kill('SIGKILL');
}

function encerrarFfmpegNoWindows(pid) {
    try {
        exec(`taskkill /F /PID ${pid}`, (err) => {
            if (!err) return;
            console.warn(`[RTMP] taskkill failed for PID ${pid}, falling back to kill()`);
            matarFfmpegSeAindaExiste();
        });
    } catch (e) {
        matarFfmpegSeAindaExiste();
    }
}

function encerrarFfmpeg(pid) {
    if (process.platform === 'win32') encerrarFfmpegNoWindows(pid);
    else ffmpegProcess.kill('SIGKILL');
}

function esperarFimDoFfmpeg(processo) {
    return new Promise((resolve) => {
        processo.once('close', resolve);
        processo.once('exit', resolve);
        setTimeout(resolve, 1000);
    });
}

async function stopBroadcast() {
    fecharEntradaDeVideo();
    if (!ffmpegProcess) return true;
    const pid = ffmpegProcess.pid;
    const terminou = esperarFimDoFfmpeg(ffmpegProcess);
    encerrarFfmpeg(pid);
    await terminou;
    ffmpegProcess = null;
    console.info('[RTMP] Stopped FFmpeg broadcaster stream');
    return true;
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
    encaminharPortaAdb,
    stopBroadcast,
    receiveVideoChunk
};
