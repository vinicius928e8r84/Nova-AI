'use strict';

const ANTES_DAS_VARIAVEIS = `
console.log("[Nova] CDP Stealth Injector Initializing (MAIN World)...");
try {
  for (let prop in window) {
    if (typeof prop === 'string' && prop.match(/cdc_[a-zA-Z0-9]+_/)) {
      try { delete window[prop]; } catch(e) {}
    }
  }
} catch(e) {}

try {
  const ogGetOwnPropertyNames = Object.getOwnPropertyNames;
  Object.getOwnPropertyNames = function(obj) {
    const names = ogGetOwnPropertyNames(obj);
    return names.filter(n => typeof n !== 'string' || !n.match(/cdc_[a-zA-Z0-9]+_/));
  };
} catch(e) {}

try {
  Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', {
    get: () => false,
    configurable: true,
    enumerable: true
  });
} catch(e) {}

try { delete window.vivaldi; } catch(e) {}
try { delete window.Brave; } catch(e) {}
try { if (navigator.brave) delete navigator.brave; } catch(e) {}

try {
  const observer = new MutationObserver((mutations) => {
    for (let m of mutations) {
      for (let node of m.addedNodes) {
        if (node.id && typeof node.id === 'string' && node.id.includes('vivaldi')) {
          try { node.remove(); } catch(e) {}
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
} catch(e) {}
`;

const DEPOIS_DAS_VARIAVEIS = `var _lbl = _virtualCamLabel;

function applyStealth(win) {
  if (!win || win.__nova_stealth_applied) return;
  win.__nova_stealth_applied = true;

  // Stealth: Mask Function.prototype.toString
  try {
    if (!win.__nova_toString_hooked) {
      win.__nova_toString_hooked = true;
      var originalToString = win.Function.prototype.toString;
      win.Function.prototype.toString = function toString() {
        if (this === win.Function.prototype.toString) return "function toString() { [native code] }";
        var res = originalToString.call(this);
        if (res.indexOf('[native code]') === -1 && this.name) {
          var stealthNames = ['enumerateDevices', 'getUserMedia', 'getParameter', 'getCurrentPosition', 'readPixels', 'getChannelData', 'getBoundingClientRect', 'getVoices', 'getSettings', 'getCapabilities', 'watchPosition', 'getImageData', 'toDataURL', 'createOscillator', 'fetch', 'open', 'getTimezoneOffset', 'resolvedOptions'];
          if (stealthNames.includes(this.name) || this.name.startsWith('get') || this.name.startsWith('set')) return "function " + this.name + "() { [native code] }";
        }
        return res;
      };
      Object.defineProperty(win.Function.prototype.toString, 'name', { value: 'toString' });
    }
  } catch(e) {}

  // Proxy window.frames
  try {
    var framesProxy = new Proxy(win, {
      get: function(target, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          var res = target[prop];
          if (res) { try { applyStealth(res); } catch(e){} }
          return res;
        }
        var res = target[prop];
        if (typeof res === 'function') { return res.bind(target); }
        return res;
      }
    });
    Object.defineProperty(win, 'frames', { get: function() { return framesProxy; }, configurable: true });
  } catch(e) {}
  
  // Timezone & Date Overrides
  try {
    var targetTimezone = _tTimezone;
    var targetOffset = _tOffset;
    var targetLocale = _tLocale;
    var targetLocales = _tLocales;

    var orgDTF = win.Intl.DateTimeFormat;
    var orgResolvedOptions = orgDTF.prototype.resolvedOptions;
    orgDTF.prototype.resolvedOptions = function() {
      var res = orgResolvedOptions.apply(this, arguments);
      res.timeZone = targetTimezone;
      res.locale = targetLocale;
      return res;
    };

    win.Intl.DateTimeFormat = function(locales, options) {
      var resolvedLocales = locales || targetLocales;
      var resolvedOptions = Object.assign({}, options);
      if (!resolvedOptions.timeZone) resolvedOptions.timeZone = targetTimezone;
      return new orgDTF(resolvedLocales, resolvedOptions);
    };
    win.Intl.DateTimeFormat.prototype = orgDTF.prototype;
    win.Intl.DateTimeFormat.supportedLocalesOf = orgDTF.supportedLocalesOf;

    var orgDate = win.Date;
    var orgGetTimezoneOffset = orgDate.prototype.getTimezoneOffset;
    orgDate.prototype.getTimezoneOffset = function() { return targetOffset; };

    var getShiftedDate = function(dateInst) {
      var systemOffset = orgGetTimezoneOffset.call(dateInst);
      var diffMin = systemOffset - targetOffset;
      return new orgDate(dateInst.getTime() + diffMin * 60000);
    };

    var localGetMethods = ['getDate', 'getDay', 'getFullYear', 'getHours', 'getMilliseconds', 'getMinutes', 'getMonth', 'getSeconds'];
    localGetMethods.forEach(function(m) {
      var utcMethod = m.replace('get', 'getUTC');
      orgDate.prototype[m] = function() { return getShiftedDate(this)[utcMethod](); };
    });

    var localSetMethods = ['setDate', 'setFullYear', 'setHours', 'setMilliseconds', 'setMinutes', 'setMonth', 'setSeconds'];
    localSetMethods.forEach(function(m) {
      var utcMethod = m.replace('set', 'setUTC');
      orgDate.prototype[m] = function() {
        var shifted = getShiftedDate(this);
        var res = shifted[utcMethod].apply(shifted, arguments);
        var systemOffset = orgGetTimezoneOffset.call(this);
        var diffMin = systemOffset - targetOffset;
        this.setTime(shifted.getTime() - diffMin * 60000);
        return res;
      };
    });

    orgDate.prototype.toString = function() {
      var opt = { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: targetTimezone };
      var dtf = new orgDTF(targetLocale, opt);
      var parts = dtf.formatToParts(this);
      var p = {};
      parts.forEach(function(x) { p[x.type] = x.value; });
      return p.weekday + " " + p.month + " " + p.day + " " + p.year + " " + p.hour + ":" + p.minute + ":" + p.second + " " + _tGMT;
    };

    orgDate.prototype.toTimeString = function() {
      var dtf = new orgDTF(targetLocale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: targetTimezone });
      return dtf.format(this) + " " + _tGMT;
    };

    orgDate.prototype.toDateString = function() {
      return new orgDTF(targetLocale, { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', timeZone: targetTimezone }).format(this);
    };
  } catch(e) {}

  // Geolocation API Override
  try {
    if (win.navigator.geolocation) {
      win.navigator.geolocation.getCurrentPosition = function(success) {
        if (typeof success === 'function') {
          setTimeout(function() {
            success({ coords: { latitude: _tLat, longitude: _tLng, accuracy: 15, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
          }, 10);
        }
      };
      win.navigator.geolocation.watchPosition = function(success) {
        if (typeof success === 'function') {
          var trigger = function() {
            success({ coords: { latitude: _tLat, longitude: _tLng, accuracy: 15, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
          };
          trigger();
          return setInterval(trigger, 5000);
        }
        return 0;
      };
    }
  } catch(e) {}

  // Navigator Properties
  try {
    var navProto = win.Navigator && win.Navigator.prototype ? win.Navigator.prototype : win.navigator;
    Object.defineProperty(navProto, "platform", { get: function() { return _platformStr; }, configurable: true });
    Object.defineProperty(navProto, "hardwareConcurrency", { get: function() { return _cpuCores; }, configurable: true });
    Object.defineProperty(navProto, "deviceMemory", { get: function() { return _ramSize; }, configurable: true });
    Object.defineProperty(navProto, "webdriver", { get: function() { return undefined; }, configurable: true });
    Object.defineProperty(navProto, "language", { get: function() { return _tLocale; }, configurable: true });
    Object.defineProperty(navProto, "languages", { get: function() { return _tLocales; }, configurable: true });
    if (_m) { Object.defineProperty(navProto, "maxTouchPoints", { get: function() { return 10; }, configurable: true }); }
  } catch(e) {}

  // WebGL GPU Spoof
  try {
    var gpuVendor = _gpuVendor;
    var gpuRenderer = _gpuRenderer;
    
    var spoofGL = function(proto) {
      if (!proto || !proto.getParameter) return;
      var _ogGetParam = proto.getParameter;
      Object.defineProperty(proto, 'getParameter', {
        value: function(p) {
          if (p === 37446 || p === 7937) return gpuRenderer;
          if (p === 37445 || p === 7936) return gpuVendor;
          return _ogGetParam.call(this, p);
        },
        writable: true, configurable: true
      });
    };
    if (win.WebGLRenderingContext) spoofGL(win.WebGLRenderingContext.prototype);
    if (win.WebGL2RenderingContext) spoofGL(win.WebGL2RenderingContext.prototype);
  } catch(e) {}

`;

module.exports = { ANTES_DAS_VARIAVEIS, DEPOIS_DAS_VARIAVEIS };
