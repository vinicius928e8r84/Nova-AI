#!/usr/bin/env node
/* Testes do leitor de proxy (com senhas falsas de mesmo formato). */
const P = require("../MAC/integracao-iphone/conexao-usb/proxy-parse.js");
const PASS = "segredoFalso_country-US_mode-quality_session-AAAABBBB_lifetime-1440";
let falhas = 0;
function eq(nome, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log((ok ? "ok   " : "FALHA") + "  " + nome + (ok ? "" : "\n        veio: " + JSON.stringify(real) + "\n        quer: " + JSON.stringify(esperado)));
}

// 1. a string exata que o usuario colou (ordem da Evomi, com @)
eq("evomi host:porta@usuario:senha", P.parse("premium-residential.evomi.com:1002@usuariofalso:" + PASS),
  { scheme: "", host: "premium-residential.evomi.com", port: 1002, user: "usuariofalso", pass: PASS });

// 2. ordem padrao
eq("usuario:senha@host:porta", P.parse("usuariofalso:" + PASS + "@premium-residential.evomi.com:1002"),
  { scheme: "", host: "premium-residential.evomi.com", port: 1002, user: "usuariofalso", pass: PASS });

// 3. forma que o aparelho usa (host:porta:usuario:senha)
eq("socks5://host:porta:usuario:senha", P.parse("socks5://premium-residential.evomi.com:1002:usuariofalso:" + PASS),
  { scheme: "socks5", host: "premium-residential.evomi.com", port: 1002, user: "usuariofalso", pass: PASS });

// 4. http com credenciais e porta 8080
eq("http://usuario:senha@host:porta", P.parse("http://aquiles:segredo123@us.exemplo.com:8080"),
  { scheme: "http", host: "us.exemplo.com", port: 8080, user: "aquiles", pass: "segredo123" });

// 5. https sem esquema, ordem do aparelho
eq("https host:porta:usuario:senha", P.parse("https.exemplo.com:1001:aquiles:segredo"),
  { scheme: "", host: "https.exemplo.com", port: 1001, user: "aquiles", pass: "segredo" });

// 6. so IP e porta, sem credenciais
eq("ip:porta sem credenciais", P.parse("1.2.3.4:8000"),
  { scheme: "", host: "1.2.3.4", port: 8000, user: "", pass: "" });

// 7. usuario:senha:host:porta (ordem invertida sem @)
eq("usuario:senha:host:porta", P.parse("aquiles:segredo:us.exemplo.com:9000"),
  { scheme: "", host: "us.exemplo.com", port: 9000, user: "aquiles", pass: "segredo" });

// 8. socks5h com senha contendo ":"
eq("socks5h senha com dois-pontos", P.parse("socks5h://aquiles:pa:ss@host.exemplo.com:1080"),
  { scheme: "socks5h", host: "host.exemplo.com", port: 1080, user: "aquiles", pass: "pa:ss" });

// 9. errros
eq("sem porta -> recusa", P.parse("premium-residential.evomi.com"), null);
eq("porta fora da faixa -> recusa", P.parse("host.exemplo.com:99999"), null);
eq("vazio -> recusa", P.parse("   "), null);
eq("lixo -> recusa", P.parse("proxy da evomi"), null);

// 10. canonicos
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
