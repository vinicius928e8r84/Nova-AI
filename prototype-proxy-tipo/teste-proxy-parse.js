#!/usr/bin/env node
const P = require("../MAC/integracao-iphone/conexao-usb/proxy-parse.js");
const PASS = "segredoFalso_country-US_mode-quality_session-AAAABBBB_lifetime-1440";
let falhas = 0;
function relatoDaFalha(nome, real, esperado) {
  return "FALHA  " + nome + "\n        veio: " + JSON.stringify(real) + "\n        quer: " + JSON.stringify(esperado);
}
function eq(nome, real, esperado) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) {
    console.info("ok     " + nome);
    return;
  }
  falhas++;
  console.info(relatoDaFalha(nome, real, esperado));
}

eq("evomi host:porta@usuario:senha", P.parse("premium-residential.evomi.com:1002@usuariofalso:" + PASS),
  { scheme: "", host: "premium-residential.evomi.com", port: 1002, user: "usuariofalso", pass: PASS });

eq("usuario:senha@host:porta", P.parse("usuariofalso:" + PASS + "@premium-residential.evomi.com:1002"),
  { scheme: "", host: "premium-residential.evomi.com", port: 1002, user: "usuariofalso", pass: PASS });

eq("socks5://host:porta:usuario:senha", P.parse("socks5://premium-residential.evomi.com:1002:usuariofalso:" + PASS),
  { scheme: "socks5", host: "premium-residential.evomi.com", port: 1002, user: "usuariofalso", pass: PASS });

eq("http://usuario:senha@host:porta", P.parse("http://aquiles:segredo123@us.exemplo.com:8080"),
  { scheme: "http", host: "us.exemplo.com", port: 8080, user: "aquiles", pass: "segredo123" });

eq("https host:porta:usuario:senha", P.parse("https.exemplo.com:1001:aquiles:segredo"),
  { scheme: "", host: "https.exemplo.com", port: 1001, user: "aquiles", pass: "segredo" });

eq("ip:porta sem credenciais", P.parse("1.2.3.4:8000"),
  { scheme: "", host: "1.2.3.4", port: 8000, user: "", pass: "" });

eq("usuario:senha:host:porta", P.parse("aquiles:segredo:us.exemplo.com:9000"),
  { scheme: "", host: "us.exemplo.com", port: 9000, user: "aquiles", pass: "segredo" });

eq("socks5h senha com dois-pontos", P.parse("socks5h://aquiles:pa:ss@host.exemplo.com:1080"),
  { scheme: "socks5h", host: "host.exemplo.com", port: 1080, user: "aquiles", pass: "pa:ss" });

eq("sem porta -> recusa", P.parse("premium-residential.evomi.com"), null);
eq("porta fora da faixa -> recusa", P.parse("host.exemplo.com:99999"), null);
eq("vazio -> recusa", P.parse("   "), null);
eq("lixo -> recusa", P.parse("proxy da evomi"), null);

eq("canonico da string da evomi", P.norm("premium-residential.evomi.com:1002@usuariofalso:" + PASS),
  "socks5://premium-residential.evomi.com:1002:usuariofalso:" + PASS);
eq("canonico http preserva tipo", P.norm("usuario:senha@us.exemplo.com:8080", "http"),
  "http://us.exemplo.com:8080:usuario:senha");
eq("tipo lido da string", P.schemeOf("http://usuario:senha@us.exemplo.com:8080"), "http");
eq("tipo padrao", P.schemeOf("premium-residential.evomi.com:1002@u:p"), "socks5");
eq("trocar tipo mantem o resto", P.withScheme("https", "premium-residential.evomi.com:1002@u:p"),
  "https://premium-residential.evomi.com:1002:u:p");
eq("trocar tipo em texto incompleto", P.withScheme("http", "us.exemplo.com:80"), "http://us.exemplo.com:80");

console.log(falhas ? "\n" + falhas + " FALHA(S)" : "\nTODOS OS TESTES PASSARAM");
process.exit(falhas ? 1 : 0);
