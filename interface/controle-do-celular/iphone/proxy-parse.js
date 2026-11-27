function pIsPort(pT) {
  return /^[0-9]{1,5}$/.test(pT) && +pT > 0 && +pT <= 65535;
}

function pIsHost(pT) {
  if (!pT || pT.length < 3) return false;
  if (pT === "localhost") return true;
  if (pT.indexOf(".") < 1) return false;
  if (!/^[A-Za-z0-9._\-\[\]]+$/.test(pT)) return false;
  if (/^[0-9]+$/.test(pT)) return false;
  return true;
}

function pSplitHostPort(pT) {
  var pA = String(pT).split(":");
  return { h: pA[0], p: pA[1] || "" };
}

function pParseProxy(pRaw) {
  if (typeof pRaw !== "string") return null;
  var pIn = pRaw.trim();
  if (!pIn) return null;
  var pSch = "";
  var pSm = pIn.match(/^([A-Za-z][A-Za-z0-9+.\-]*):\/\//);
  if (pSm) {
    pSch = pSm[1].toLowerCase();
    pIn = pIn.slice(pSm[0].length);
  }
  var pHost = "", pPort = "", pUser = "", pPass = "";
  var pAt = pIn.lastIndexOf("@");
  if (pAt >= 0) {
    var pLeft = pIn.slice(0, pAt);
    var pRight = pIn.slice(pAt + 1);
    var pL = pSplitHostPort(pLeft);
    var pR = pSplitHostPort(pRight);
    var pCreds = "";
    if (pIsHost(pL.h) && pIsPort(pL.p)) {
      pHost = pL.h; pPort = pL.p; pCreds = pRight;
    } else if (pIsHost(pR.h) && pIsPort(pR.p)) {
      pHost = pR.h; pPort = pR.p; pCreds = pLeft;
    } else {
      return null;
    }
    var pC = pCreds.indexOf(":");
    if (pC > 0) { pUser = pCreds.slice(0, pC); pPass = pCreds.slice(pC + 1); }
    else if (pCreds) { pUser = pCreds; pPass = ""; }
  } else {
    var pA = pIn.split(":");
    var pN = pA.length;
    if (pN === 2 && pIsHost(pA[0]) && pIsPort(pA[1])) {
      pHost = pA[0]; pPort = pA[1];
    } else if (pN === 4 && pIsHost(pA[0]) && pIsPort(pA[1]) && pA[2]) {
      pHost = pA[0]; pPort = pA[1]; pUser = pA[2]; pPass = pA[3];
    } else if (pN >= 5 && pIsHost(pA[0]) && pIsPort(pA[1]) && pA[2]) {
      pHost = pA[0]; pPort = pA[1]; pUser = pA[2]; pPass = pA.slice(3).join(":");
    } else if (pN >= 4 && pIsPort(pA[pN - 1]) && pIsHost(pA[pN - 2]) && pA[0]) {
      pHost = pA[pN - 2]; pPort = pA[pN - 1];
      pUser = pA[0]; pPass = pA.slice(1, pN - 2).join(":");
    } else {
      return null;
    }
  }
  if (!pIsHost(pHost) || !pIsPort(pPort)) return null;
  return { scheme: pSch, host: pHost, port: +pPort, user: pUser, pass: pPass };
}

function pBuildProxy(pScheme, pO) {
  var pSc = String(pScheme || pO.scheme || "socks5").toLowerCase().replace(/:\/\/$/, "");
  var pBase = pSc + "://" + pO.host + ":" + pO.port;
  return pO.user ? pBase + ":" + pO.user + ":" + pO.pass : pBase;
}

function pNormProxy(pRaw, pForceScheme) {
  var pO = pParseProxy(pRaw);
  return pO ? pBuildProxy(pForceScheme || "", pO) : String(pRaw || "").trim();
}

function pSchemeOf(pRaw) {
  var pO = pParseProxy(pRaw);
  if (pO && pO.scheme) return pO.scheme;
  var pSm = String(pRaw || "").match(/^([A-Za-z][A-Za-z0-9+.\-]*):\/\//);
  return pSm ? pSm[1].toLowerCase() : "socks5";
}

function pWithScheme(pScheme, pRaw) {
  var pO = pParseProxy(pRaw);
  if (pO) return pBuildProxy(pScheme, pO);
  var pSem = String(pRaw || "").replace(/^[A-Za-z][A-Za-z0-9+.\-]*:\/\//, "");
  return pScheme + "://" + pSem;
}

var PV_EXPORTS = {
  parse: pParseProxy,
  build: pBuildProxy,
  norm: pNormProxy,
  schemeOf: pSchemeOf,
  withScheme: pWithScheme,
  isValid: function (pV) { return !!pParseProxy(pV); }
};
if (typeof module !== "undefined" && module.exports) module.exports = PV_EXPORTS;
