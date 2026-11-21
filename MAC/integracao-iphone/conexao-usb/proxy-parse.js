/* Nova AI - leitura de proxy do iPhone.
   Extrai SO o que interessa (host, porta, usuario, senha) de qualquer formato colado.
   Formato aceito na entrada (todos):
     host:porta                host:porta:usuario:senha      usuario:senha@host:porta
     host:porta@usuario:senha  socks5://host:porta:usuario:senha   http://usuario:senha@host:porta
     usuario:senha:host:porta  (com ou sem esquema na frente)
   A senha pode conter ":" (ex.: _country-US_mode-quality_session-x_lifetime-1440). */

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

var P_ESQUEMA = /^([A-Za-z][A-Za-z0-9+.\-]*):\/\//;

function pHostPortValidos(pHp) {
  return pIsHost(pHp.h) && pIsPort(pHp.p);
}

function pSepararEsquema(pIn) {
  var pSm = pIn.match(P_ESQUEMA);
  if (!pSm) return { esquema: "", resto: pIn };
  return { esquema: pSm[1].toLowerCase(), resto: pIn.slice(pSm[0].length) };
}

function pEndereco(pHp, pCreds) {
  var pC = pCreds.indexOf(":");
  if (pC > 0) return { host: pHp.h, port: pHp.p, user: pCreds.slice(0, pC), pass: pCreds.slice(pC + 1) };
  return { host: pHp.h, port: pHp.p, user: pCreds, pass: "" };
}

function pLerComArroba(pIn, pAt) {
  var pLeft = pIn.slice(0, pAt);
  var pRight = pIn.slice(pAt + 1);
  var pL = pSplitHostPort(pLeft);
  var pR = pSplitHostPort(pRight);
  if (pHostPortValidos(pL)) return pEndereco(pL, pRight);
  if (pHostPortValidos(pR)) return pEndereco(pR, pLeft);
  return null;
}

function pLerHostPorta(pA) {
  if (!pHostPortValidos({ h: pA[0], p: pA[1] })) return null;
  return { host: pA[0], port: pA[1], user: "", pass: "" };
}

function pLerHostPrimeiro(pA) {
  if (!pA[2] || !pHostPortValidos({ h: pA[0], p: pA[1] })) return null;
  return { host: pA[0], port: pA[1], user: pA[2], pass: pA.slice(3).join(":") };
}

function pLerHostPorUltimo(pA) {
  var pN = pA.length;
  if (!pA[0] || !pHostPortValidos({ h: pA[pN - 2], p: pA[pN - 1] })) return null;
  return { host: pA[pN - 2], port: pA[pN - 1], user: pA[0], pass: pA.slice(1, pN - 2).join(":") };
}

function pLerSemArroba(pIn) {
  var pA = pIn.split(":");
  if (pA.length === 2) return pLerHostPorta(pA);
  if (pA.length < 4) return null;
  return pLerHostPrimeiro(pA) || pLerHostPorUltimo(pA);
}

function pLerEndereco(pIn) {
  var pAt = pIn.lastIndexOf("@");
  return pAt >= 0 ? pLerComArroba(pIn, pAt) : pLerSemArroba(pIn);
}

function pParseProxy(pRaw) {
  if (typeof pRaw !== "string") return null;
  var pIn = pRaw.trim();
  if (!pIn) return null;
  var pE = pSepararEsquema(pIn);
  var pO = pLerEndereco(pE.resto);
  if (!pO) return null;
  return { scheme: pE.esquema, host: pO.host, port: +pO.port, user: pO.user, pass: pO.pass };
}

/* Monta a string canonica que o novaproxy do iPhone entende: esquema://host:porta:usuario:senha */
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
  var pSm = String(pRaw || "").match(P_ESQUEMA);
  return pSm ? pSm[1].toLowerCase() : "socks5";
}

/* Troca so o tipo, mantendo tudo o que ja foi colado. */
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
