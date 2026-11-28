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

function pHostEPortaValidos(pH, pP) {
  return pIsHost(pH) && pIsPort(pP);
}

function pEndereco(pHost, pPort, pUser, pPass) {
  return { host: pHost, port: pPort, user: pUser, pass: pPass };
}

function pSepararEsquema(pIn) {
  var pSm = pIn.match(/^([A-Za-z][A-Za-z0-9+.\-]*):\/\//);
  if (!pSm) return { esquema: "", resto: pIn };
  return { esquema: pSm[1].toLowerCase(), resto: pIn.slice(pSm[0].length) };
}

function pComCredenciais(pHp, pCreds) {
  var pC = pCreds.indexOf(":");
  if (pC > 0) return pEndereco(pHp.h, pHp.p, pCreds.slice(0, pC), pCreds.slice(pC + 1));
  return pEndereco(pHp.h, pHp.p, pCreds, "");
}

function pLerComArroba(pIn) {
  var pAt = pIn.lastIndexOf("@");
  var pLeft = pIn.slice(0, pAt);
  var pRight = pIn.slice(pAt + 1);
  var pL = pSplitHostPort(pLeft);
  var pR = pSplitHostPort(pRight);
  if (pHostEPortaValidos(pL.h, pL.p)) return pComCredenciais(pL, pRight);
  if (pHostEPortaValidos(pR.h, pR.p)) return pComCredenciais(pR, pLeft);
  return null;
}

function pLerHostPorta(pA) {
  if (pA.length !== 2 || !pHostEPortaValidos(pA[0], pA[1])) return null;
  return pEndereco(pA[0], pA[1], "", "");
}

function pLerHostPortaUsuarioSenha(pA) {
  if (pA.length < 4 || !pA[2]) return null;
  if (!pHostEPortaValidos(pA[0], pA[1])) return null;
  return pEndereco(pA[0], pA[1], pA[2], pA.slice(3).join(":"));
}

function pLerUsuarioSenhaHostPorta(pA) {
  var pN = pA.length;
  if (pN < 4 || !pA[0]) return null;
  if (!pHostEPortaValidos(pA[pN - 2], pA[pN - 1])) return null;
  return pEndereco(pA[pN - 2], pA[pN - 1], pA[0], pA.slice(1, pN - 2).join(":"));
}

function pLerSemArroba(pIn) {
  var pA = pIn.split(":");
  return pLerHostPorta(pA) || pLerHostPortaUsuarioSenha(pA) || pLerUsuarioSenhaHostPorta(pA);
}

function pParseProxy(pRaw) {
  if (typeof pRaw !== "string") return null;
  var pIn = pRaw.trim();
  if (!pIn) return null;
  var pPartes = pSepararEsquema(pIn);
  var pAchado = pPartes.resto.indexOf("@") >= 0 ? pLerComArroba(pPartes.resto) : pLerSemArroba(pPartes.resto);
  if (!pAchado) return null;
  return { scheme: pPartes.esquema, host: pAchado.host, port: +pAchado.port, user: pAchado.user, pass: pAchado.pass };
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
