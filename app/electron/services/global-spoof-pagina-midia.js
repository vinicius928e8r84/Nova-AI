'use strict';

const TEXTO_DA_MIDIA = `  // MediaStreamTrack Prototype Labels
  try {
    if (win.MediaStreamTrack) {
      var _ogSettings = win.MediaStreamTrack.prototype.getSettings;
      win.MediaStreamTrack.prototype.getSettings = function() {
        var s = _ogSettings.call(this) || {};
        if (this.kind === "video") {
          s.deviceId = _devId; s.groupId = _grpId; s.facingMode = "user"; s.width = _cW; s.height = _cH; s.frameRate = 30;
        }
        return s;
      };
      
      var _ogCaps = win.MediaStreamTrack.prototype.getCapabilities;
      if (_ogCaps) {
        win.MediaStreamTrack.prototype.getCapabilities = function() {
          var c = _ogCaps.call(this) || {};
          if (this.kind === "video") {
            c.facingMode = ["user"]; c.deviceId = _devId; c.groupId = _grpId;
            c.width = { max: _cW, min: 320 }; c.height = { max: _cH, min: 240 }; c.frameRate = { max: 30, min: 15 };
          }
          return c;
        };
      }

      Object.defineProperty(win.MediaStreamTrack.prototype, "label", {
        get: function() { return this.kind === "video" ? _lbl : "Microphone (High Definition Audio Device)"; },
        configurable: true
      });
      Object.defineProperty(win.MediaStreamTrack.prototype, "id", {
        get: function() { return this.kind === "video" ? _devId : "mock_audio_track_id"; },
        configurable: true
      });
    }
  } catch(e) {}

  // EnumerateDevices Hook (Maps Native IDs to Spoofed IDs)
  try {
    if (win.MediaDevices && win.MediaDevices.prototype.enumerateDevices) {
      var orgEnum = win.MediaDevices.prototype.enumerateDevices;
      win.MediaDevices.prototype.enumerateDevices = function enumerateDevices() {
        return orgEnum.call(this).then(function(devices) {
          return devices.map(function(d) {
            if (d.kind === "videoinput") {
              if (d.deviceId && d.deviceId !== _virtualCamId) {
                win.__nova_native_cam_id = d.deviceId;
              }
              try {
                Object.defineProperty(d, "label", { get: function() { return _virtualCamLabel; }, enumerable: true, configurable: true });
                Object.defineProperty(d, "deviceId", { get: function() { return _virtualCamId; }, enumerable: true, configurable: true });
                Object.defineProperty(d, "groupId", { get: function() { return _virtualCamId; }, enumerable: true, configurable: true });
              } catch(e) {}
            } else if (d.kind === "audioinput") {
              try {
                Object.defineProperty(d, "label", { get: function() { return _virtualMicLabel; }, enumerable: true, configurable: true });
                Object.defineProperty(d, "deviceId", { get: function() { return _virtualMicId; }, enumerable: true, configurable: true });
                Object.defineProperty(d, "groupId", { get: function() { return _virtualMicId; }, enumerable: true, configurable: true });
              } catch(e) {}
            } else if (d.kind === "audiooutput") {
              try {
                Object.defineProperty(d, "label", { get: function() { return _virtualSpeakerLabel; }, enumerable: true, configurable: true });
                Object.defineProperty(d, "deviceId", { get: function() { return _virtualSpeakerId; }, enumerable: true, configurable: true });
                Object.defineProperty(d, "groupId", { get: function() { return _virtualSpeakerId; }, enumerable: true, configurable: true });
              } catch(e) {}
            }
            return d;
          });
        });
      };
    }
  } catch(e) {}

  // getUserMedia Interceptor (Remaps constraints back to native IDs)
  try {
    var overrideGUM = function(constraints, _ogGUM) {
      if (!constraints) constraints = { video: true };
      console.log("[Nova] getUserMedia intercepted:", JSON.stringify(constraints));
      
      if (constraints.video) {
        var nativeId = win.__nova_native_cam_id;
        if (typeof constraints.video === 'object') {
          if (constraints.video.deviceId) {
            var requestedId = constraints.video.deviceId.exact || constraints.video.deviceId.ideal || constraints.video.deviceId;
            if (requestedId === _virtualCamId && nativeId) {
              if (constraints.video.deviceId.exact) constraints.video.deviceId.exact = nativeId;
              else if (constraints.video.deviceId.ideal) constraints.video.deviceId.ideal = nativeId;
              else constraints.video.deviceId = nativeId;
            } else {
              delete constraints.video.deviceId;
            }
          }
        } else {
          // If true, keep it true so it defaults to the single native fake camera
          if (nativeId) {
            constraints.video = { deviceId: { exact: nativeId } };
          }
        }
      }
      return _ogGUM(constraints);
    };

    if (win.MediaDevices && win.MediaDevices.prototype.getUserMedia) {
      var _ogM = win.MediaDevices.prototype.getUserMedia;
      win.MediaDevices.prototype.getUserMedia = function getUserMedia(c) { return overrideGUM(c, _ogM.bind(this)); };
    }
    if (win.navigator.mediaDevices && win.navigator.mediaDevices.getUserMedia) {
      var _ogM2 = win.navigator.mediaDevices.getUserMedia;
      win.navigator.mediaDevices.getUserMedia = function getUserMedia(c) { return overrideGUM(c, _ogM2.bind(win.navigator.mediaDevices)); };
    }
  } catch(err) {}

  // Canvas Noise Injection
  try {
    if (_canvasNoise) {
      var spoofCanvas = function(proto) {
        var ogToDataURL = proto.toDataURL;
        proto.toDataURL = function() {
          var ctx = this.getContext('2d');
          if (ctx) {
            var ogFillText = ctx.fillText;
            ctx.fillText = function() {
              ctx.fillStyle = 'rgba(0,0,0,0.01)';
              ogFillText.apply(this, arguments);
            };
          }
          return ogToDataURL.apply(this, arguments);
        };
        
        var ogGetImageData = proto.getContext ? HTMLCanvasElement.prototype.getContext : null;
        if (win.CanvasRenderingContext2D) {
          var ogGetImg = win.CanvasRenderingContext2D.prototype.getImageData;
          win.CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
            var res = ogGetImg.apply(this, arguments);
            if (res && res.data) {
              var seed = _canvasNoiseSeed || 42;
              for (var i = 0; i < res.data.length; i += 4) {
                res.data[i] = (res.data[i] + ((i + seed) % 3)) % 256;
              }
            }
            return res;
          };
        }
      };
      spoofCanvas(win.HTMLCanvasElement.prototype);
    }
  } catch(e) {}

  // WebGL Image Noise
  try {
    if (_webglImageNoise && win.WebGLRenderingContext) {
      var ogReadPixels = win.WebGLRenderingContext.prototype.readPixels;
      win.WebGLRenderingContext.prototype.readPixels = function(x, y, w, h, format, type, pixels) {
        ogReadPixels.apply(this, arguments);
        if (pixels && pixels.length > 0) {
          var seed = _webglNoiseSeed || 88;
          for (var i = 0; i < Math.min(pixels.length, 100); i++) {
            pixels[i] = (pixels[i] + ((i + seed) % 3)) % 256;
          }
        }
      };
    }
    if (_webglImageNoise && win.WebGL2RenderingContext) {
      var ogReadPixels2 = win.WebGL2RenderingContext.prototype.readPixels;
      win.WebGL2RenderingContext.prototype.readPixels = function(x, y, w, h, format, type, pixels) {
        ogReadPixels2.apply(this, arguments);
        if (pixels && pixels.length > 0) {
          var seed = _webglNoiseSeed || 88;
          for (var i = 0; i < Math.min(pixels.length, 100); i++) {
            pixels[i] = (pixels[i] + ((i + seed) % 3)) % 256;
          }
        }
      };
    }
  } catch(e) {}

  // ClientRects Noise Injection
  try {
    if (_clientRectsNoise) {
      var spoofRects = function(proto, name) {
        if (!proto || !proto[name]) return;
        var og = proto[name];
        proto[name] = function() {
          var res = og.apply(this, arguments);
          if (res && typeof res.width === 'number') {
            var factor = 0.0001 * (Math.random() - 0.5);
            Object.defineProperty(res, 'width', { get: function() { return res.width + factor; }, configurable: true });
            Object.defineProperty(res, 'height', { get: function() { return res.height + factor; }, configurable: true });
          }
          return res;
        };
      };
      spoofRects(win.Element.prototype, 'getBoundingClientRect');
    }
  } catch(e) {}

  // Audio Context Noise
  try {
    if (_audioNoise) {
      if (win.BaseAudioContext && win.BaseAudioContext.prototype.createOscillator) {
        var ogCreateOscillator = win.BaseAudioContext.prototype.createOscillator;
        win.BaseAudioContext.prototype.createOscillator = function() {
          var osc = ogCreateOscillator.apply(this, arguments);
          var ogFrequency = osc.frequency.value;
          var offset = (_audioNoiseSeed || 0.0000001) * 1000;
          Object.defineProperty(osc.frequency, 'value', {
            get: function() { return ogFrequency + offset; },
            set: function(val) { ogFrequency = val; },
            configurable: true
          });
          return osc;
        };
      }
      if (win.AudioBuffer) {
        var ogGetChannelData = win.AudioBuffer.prototype.getChannelData;
        var seed = _audioNoiseSeed || 0.0000001;
        win.AudioBuffer.prototype.getChannelData = function(channel) {
          var data = ogGetChannelData.apply(this, arguments);
          if (data && data.length > 0) {
            for (var i = 0; i < Math.min(data.length, 50); i++) {
              data[i] += seed * ((i % 3) - 1);
            }
          }
          return data;
        };
      }
    }
  } catch(e) {}

  // SpeechVoices Noise
  try {
    if (_speechVoicesNoise && win.speechSynthesis) {
      var ogGetVoices = win.SpeechSynthesis.prototype.getVoices;
      win.SpeechSynthesis.prototype.getVoices = function() {
        var list = ogGetVoices.apply(this, arguments) || [];
        return list.slice(0, list.length > 2 ? list.length - 1 : list.length);
      };
    }
  } catch(e) {}

  // Do Not Track Override
  try {
    if (_doNotTrack === 'enable') {
      Object.defineProperty(win.navigator, 'doNotTrack', { get: function() { return "1"; }, configurable: true });
      Object.defineProperty(win.window, 'doNotTrack', { get: function() { return "1"; }, configurable: true });
    } else if (_doNotTrack === 'disable') {
      Object.defineProperty(win.navigator, 'doNotTrack', { get: function() { return "0"; }, configurable: true });
      Object.defineProperty(win.window, 'doNotTrack', { get: function() { return "0"; }, configurable: true });
    }
  } catch(e) {}

  // Localhost Port Scan Blocker
  try {
    if (_portScanProtection === 'enable' && win.fetch) {
      var ogFetch = win.fetch;
      win.fetch = function(url, options) {
        var urlStr = String(url || '');
        if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
          return Promise.reject(new TypeError('Failed to fetch (Port Scan Protection Active)'));
        }
        return ogFetch.apply(this, arguments);
      };
      
      if (win.XMLHttpRequest) {
        var ogOpen = win.XMLHttpRequest.prototype.open;
        win.XMLHttpRequest.prototype.open = function(method, url) {
          var urlStr = String(url || '');
          if (urlStr.includes('127.0.0.1') || urlStr.includes('localhost')) {
            throw new Error('Connection refused (Port Scan Protection Active)');
          }
          return ogOpen.apply(this, arguments);
        };
      }
    }
  } catch(e) {}
}

applyStealth(window);

// Handle dynamic iframes
(function() {
  try {
    var orgContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow").get;
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      get: function() {
        var win = orgContentWindow.call(this);
        if (win) { try { applyStealth(win); } catch(e) {} }
        return win;
      },
      configurable: true
    });
  } catch(e) {}
})();
`;

module.exports = { TEXTO_DA_MIDIA };
