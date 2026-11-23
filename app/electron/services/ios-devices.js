'use strict';

const { execFile } = require('child_process');

function listar() {
    return new Promise((resolve) => {
        execFile(require('./ios-tools').tool('idevice_id'), ['-l'], { timeout: 6000, windowsHide: true }, (err, stdout) => {
            if (err || !stdout) return resolve([]);
            const udids = String(stdout).split('\n').map(s => s.trim()).filter(Boolean);
            const out = [];
            let pending = udids.length;
            if (!pending) return resolve([]);
            for (const udid of udids) {
                execFile(require('./ios-tools').tool('ideviceinfo'), ['-u', udid, '-k', 'DeviceName'], { timeout: 6000, windowsHide: true }, (e1, s1) => {
                    const name = (e1 || !s1) ? 'iPhone' : (String(s1).trim() || 'iPhone');
                    execFile(require('./ios-tools').tool('ideviceinfo'), ['-u', udid, '-k', 'ProductVersion'], { timeout: 6000, windowsHide: true }, (e2, s2) => {
                        const ver = (e2 || !s2) ? '' : String(s2).trim();
                        out.push({ id: 'ios-' + udid, status: 'device', name: name + (ver ? ' (iOS ' + ver + ')' : ''), type: 'usb', ios: true });
                        if (--pending === 0) resolve(out);
                    });
                });
            }
        });
    });
}

module.exports = { listar };
