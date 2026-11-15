# QA — seletor de idioma do aparelho no app Nova

Checklist de aceitação, linha de base e limites de verificação. **Leitura apenas** até o
usuário dar OK para escrita. Escrita do idioma é do Backend (branch); QA mede e valida.

Data da medição: 08/11/2026 ~17:20 (aparelho: iPhone 8 Plus, iPhone10,2, 16.7.16, UDID 47f4fc34…).

## 0. Como rodar (chave do app, sem root)

```
K="$HOME/Library/Application Support/nova_dsktp/iphone-ssh/id_iphone"
S() { ssh -i "$K" -p 2222 -o BatchMode=yes -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes mobile@127.0.0.1 "$@"; }
```

## 1. Linha de base (medida)

| Item | Valor agora |
|---|---|
| `/var/mobile/Library/Preferences/.GlobalPreferences.plist` | 435 B, `mobile:mobile` 600, mtime 08/11 **15:16** |
| `AppleLanguages` (disco) | `["pt-BR"]` |
| `AppleLocale` (disco) | `en_US` (estado misto: texto pt, formato data/número EUA) |
| `ApplePasscodeKeyboards` | `en_US, emoji` (teclado segue EUA) |
| Store CFPreferences | `pt-BR` (confirmado pelo time; processo novo resolve pt-BR) |
| Interface | depende de respring — SpringBoard PID 13758, iniciado ~17:17 |
| Fotos (`com.apple.mobileslideshow.plist`) | `AppleLanguages = ["pt-BR"]` (6.955 B) |
| Fuso do aparelho | `America/New_York` (2 h fora do IP de saída, Phoenix — aberto) |
| Backup do original no aparelho | **não existe**; só `/tmp/gp-check.plist` (en-US) no Mac |

## 2. Idiomas que o aparelho realmente oferece: **41**

Fonte medida: `.lproj` presentes em `/System/Library/CoreServices/SpringBoard.app`
(é o que o Ajustes lista). **Não** usar
`IntlPreferences.framework/RenderableUILanguages.plist` como lista de escolha: ele tem
**425** entradas (ab, ace, ada…) que são renderáveis, não idiomas de interface.

```
ar bg ca cs da de el en en_AU en_GB es es_419 fi fr fr_CA he hi hr hu id it ja kk ko
ms nl no pl pt pt_PT ro ru sk sv th tr uk vi zh_CN zh_HK zh_TW
```

- `pt-BR` grava como `pt-BR` e renderiza com o bundle `pt`. `pt_PT` é outro idioma.
- Regra para o seletor: **só oferecer os 41**. Fora disso a UI não muda (cai no inglês).
- As 16 opções da tela do Frontend (`1a76aad`): 15 existem. **`es-MX` não existe** como
  idioma de interface neste iOS — só `es` e `es_419`. Trocar para `es-MX`/`es-419` ou remover.
- O aparelho tem 26 idiomas que a tela não oferece (bg, ca, cs, da, el, fi, fr_CA, he, hr, hu,
  id, kk, ms, no, pl, pt_PT, ro, sk, sv, th, uk, vi, zh_HK, zh_TW, en_AU, es_419). Se a lista
  for curta por escolha, ok; só não pode se apresentar como completa.

## 3. Checklist de aceitação

Pré: app Nova aberto, iPhone no USB com SSH vivo (`S date`), CAM LIVE ligado de propósito
para observar a queda, nenhum outro agente escrevendo idioma (evitar flip-flop).

**A1 — Ler o idioma atual (só leitura)**
- Ação: botão "Ler do aparelho".
- Medir: `S 'cat /var/mobile/Library/Preferences/.GlobalPreferences.plist | strings | grep -m2 "pt-BR\|en-US"'`;
  e a resposta do IPC `spoofer:get-language`.
- Esperado: tela mostra `pt-BR / pt_BR` (ou o valor real do disco) e o campo não inventa valor.
- Falha: mostra "idioma undefined", valor fixo no código, ou o campo do país (`en_US`) como se fosse idioma.

**A2 — Aplicar pt-BR**
- Ação: escolher Português (BR) → Aplicar (precisa de OK do usuário).
- Medir: leitura de volta; `AppleLanguages` no disco; PID do SpringBoard antes/depois.
- Esperado: resposta `{success:true, language:"pt-BR", respring:true}`; disco passa a `pt-BR`;
  SpringBoard com PID novo; tela do app escreve "aplicado: pt-BR (a tela do iPhone reiniciou)".
- Falha: responde sucesso sem mudar o disco; dois resprings; erro genérico sem motivo.

**A3 — Aplicar en-US**
- Mesmo de A2 com Inglês (EUA). Esperado: disco `en-US`, resposta `en-US`, SpringBoard novo.
- Verificar também `AppleLocale` (ver R3): hoje fica `en_US` sempre.

**A4 — Idioma por app (um bundle só)**
- Ação: aplicar em `com.apple.mobileslideshow` (Fotos).
- Medir: `S 'cat /var/mobile/Library/Preferences/com.apple.mobileslideshow.plist'` (domínio do app)
  e o global, antes/depois.
- Esperado: só o domínio do app muda; o global **não** muda; sem respring (ou respring só do app).
- Falha: global mexido; bundle inexistente aceito como sucesso (a API devolve vazio sem erro — não
  confiar na escrita, sempre ler de volta); app sem a chave depois do restart.

**A5 — Reverter**
- Ação: botão Reverter (global → en-US; por app → remover override).
- Medir: disco volta ao valor anterior; chave `AppleLanguages` do domínio por app **removida**,
  não apenas vazia; comparação com `/tmp/gp-check.plist`.
- Esperado: leitura de volta = valor original; um respring; nenhuma chave órfã.
- Falha: reverte só na tela; deixa `AppleLanguages` vazio; reverte o idioma mas mexe no fuso.

**A6 — Idempotência e recusa**
- Aplicar o mesmo idioma duas vezes: **não** deve respringar na segunda (senão o CAM LIVE cai à toa).
- Idioma inexistente (`es-MX`, `xx-YY`): recusar com mensagem clara e **não** escrever nada.
- Bundle inválido: recusar; não reportar sucesso.

**A7 — Regressões a cada aplicação**
- Fuso do aparelho inalterado (`S date`), `nova-locale.err` continua 0 B.
- Modelo/perfil de spoof intacto (`spoofer:get-ios-model`).
- CAM LIVE: cai com o respring — esperado; deve voltar ao reconectar, sem reiniciar o app.
- Túnel SSH/`iproxy` 2222 sobrevive ao respring.

## 4. O que é verificável sem ligar a tela

Verificável (objetivo, por SSH/IPC):
- idioma gravado no disco e no domínio por app;
- resposta de leitura do helper/IPC (fonte de verdade do "Ler");
- respring ocorreu: PID e `etime` do SpringBoard mudam, `uptime` do aparelho **não** muda;
- fuso, log do helper, estado do bridge/CAM LIVE, túnel.

**Não** verificável sem a tela acesa (só prova visual do usuário):
- se a interface realmente está em português (Ajustes, Fotos, teclado);
- formato de data/número e vírgula decimal;
- `Accept-Language` que os sites recebem: no aparelho não há `curl`/`wget` e o Safari só se
  dirige pela tela. Sem hook ou captura de pacotes, **não** se mede hoje.
- Screenshot sai 100% preto com a tela apagada (medido 2×, 1242×2208) — não usar como prova.

## 5. Riscos que o recurso cria

1. **Accept-Language**: idioma global manda o header dos sites. pt-BR + IP/GPS dos EUA é
   incoerência que o site vê. Se o objetivo é parecer americano, o global tem de ficar `en-US`.
2. **Respring derruba o CAM LIVE** (e o app em primeiro plano no iPhone). Cada aplicação =
   uma queda; a tela precisa avisar e não respringar quando o valor não muda (A6).
3. **Gravação durável**: o valor vai para o disco; desligar limpo deixa o iPhone subindo em
   português. Não há backup no aparelho — a reversão depende de artefato no Mac.
4. **Escritor único**: dois agentes escrevendo no mesmo domínio já produziram oscilação
   en-US ↔ pt-BR. O helper do Backend tem de ser o único a escrever e sempre ler de volta.
5. **Estado misto** (`AppleLocale`/teclado em `en_US`): o seletor que só troca `AppleLanguages`
   entrega "português com formato americano" — decidir se isso é aceitável ou se o seletor
   também troca o locale (aí muda data, número e teclado).

## 6. Escopo decidido pelo usuário (08/11): idioma no aparelho INTEIRO e em TODOS os apps

Como o proxy, o GPS e o modelo: o idioma deve seguir o país da proxy e valer para tudo, não só
por app. Isso acrescenta testes ao checklist.

**A8 — Auditoria "todos os apps" (obrigatória depois de aplicar no global)**
- Medir quantos domínios de app ainda têm idioma próprio:
```
S 'cd /var/mobile/Library/Preferences; for f in *.plist; do grep -qa AppleLanguages "$f" && echo "$f"; done | wc -l'
```
- Esperado: **0 de 347**. Qualquer domínio com `AppleLanguages` é um app que continua fora do idioma
  global. Não use `strings` para isso: plist binário no aparelho devolve 0 mesmo quando a chave
  existe (testado contra o `.GlobalPreferences.plist`). Use `grep -a`.
- **Medido em 08/11 17:35: 1 de 347 — `com.apple.mobileslideshow` (Fotos) com `["pt-BR"]`,
  arquivo de 14:56, 6.955 B.** Fotos segue em português com o sistema em inglês. É o teste que
  prova se o recurso cumpre "todos os apps".

**A9 — Mapa país→idioma (para seguir a proxy)**
- O app instalado já tem 48 países mapeados. Conferi as bases contra os 41 idiomas reais:
  todas existem, **exceto `nb-NO`** (norueguês): o aparelho tem `no.lproj`, não `nb`. Medir antes
  de confiar; se não renderizar, trocar o mapa para `no-NO`.
- `es-MX`, `es-AR`, `es-CO`… renderizam pelo `es` (existe). Não são idiomas distintos — a etiqueta
  na tela deve dizer "Espanhol", não prometer variante regional.

**A10 — Automação sem tempestade de respring**
- Aplicar só quando o **país** da proxy mudar, nunca a cada abertura de aba ou leitura de IP.
  Medido antes: 3 aplicações em ~1 minuto, cada uma derrubando o CAM LIVE.
- Com `session` a Evomi troca de IP (e de cidade) durante o dia; se a troca cruzar fronteira, o
  idioma (e o fuso) mudam sozinhos no meio do uso. Se a intenção é ficar estável, `hardsession`.
- Cada aplicação no global = 1 respring = CAM LIVE cai e o app em primeiro plano fecha.

## 7. Redesenho da aba "Identidade simulada" (pedido 08/11): aceitação

### 7.1 Linha de base medida antes do redesenho (08/11, hora do aparelho)
- Fuso do aparelho: **`America/Phoenix`**, `Sun Nov 8 13:58 MST` — agora o aviso da tela
  ("GPS EM PHOENIX · FUSO AMERICA/PHOENIX") **bate** com o aparelho. Antes divergia
  (tela Phoenix, aparelho `America/New_York`).
- **A8 = 0 de 347 domínios** com idioma próprio: o override do Fotos foi limpo. "Todos os apps"
  passou a valer. Pendência encerrada com medição independente.
- `.GlobalPreferences.plist` reescrito 13:39; SpringBoard **PID 17452** (iniciado ~13:39).
- Bundle instalado da tela mudou às **17:56** (7.729.803 B, `index-Dun7lr2S.js`). Nenhum
  ajuste desta tarefa o tocou; revalidar o layout contra esse arquivo.

### 7.2 Ordem e presença dos controles (verificável na janela do Mac)
- B1 Modelo é o **primeiro** bloco da coluna esquerda.
- B2 "Aplicar modelo" e "Limpar modelo" **não existem mais**.
- B3 Idioma fica **ao lado do modelo**, com valor lido do aparelho.
- B4 Proxy logo abaixo, **sem** botão "Salvar" próprio da proxy.
- B5 Latitude e longitude abaixo da proxy, **começando vazias** (sem valor herdado da sessão anterior).
- B6 Três botões: **Salvar**, **Registrar modelo**, **Restaurar modelo/celular** — e **um único** Salvar.
- B7 Nenhum rótulo promete o que não faz ("Proxy aplicado no iPhone" só com leitura de volta).

### 7.3 Comportamento (verificável no aparelho, por leitura)
- B8 Salvar com proxy vazia e lat/lon vazias: não quebra, não aplica nada, diz o que falta.
- B9 Lat/lon vazias + proxy preenchida: Salvar **puxa** as coordenadas da proxy e mostra o valor
  confirmado (`idevicesetlocation` aplicado), não o calculado.
- B10 Lat/lon digitadas: o valor digitado **vence** a proxy; coordenada inválida
  (fora de -90..90 / -180..180, texto) é recusada com mensagem e nada é aplicado.
- B11 Salvar duas vezes seguidas: segunda vez **não** pode respringar nem reaplicar (idempotência),
  senão o CAM LIVE cai à toa.
- B12 Salvar único aplica em ordem e confere cada item: proxy → geo → GPS → fuso → idioma → modelo.
  Se um falhar, os outros continuam e o resultado é **por item**, não um "ok" geral.
- B13 Idioma: escolha manual vence; valor da proxy só preenche. Mudança de idioma = respring =
  CAM LIVE cai: tem de avisar antes e ser a última etapa.
- B14 A8 depois de Salvar: **0 de 347** domínios com override (senão não é "aparelho inteiro").
- B15 "Registrar modelo": deixar explícito se só grava o modelo no app ou se também aplica no
  aparelho. Teste: registrar sem aplicar → aparelho não muda; registrar e aplicar → modelo muda.
- B16 "Restaurar modelo/celular": define o alcance. Testar os dois sentidos e medir cada item:
  modelo (`nova-model-control.json` enabled=false), GPS (`idevicesetlocation reset`), fuso
  (revert para o original), idioma (en-US/pt-BR conforme original), proxy (`novaproxy proxy clear`),
  CAM LIVE encerrado. Nada de "restaurar" que deixa fuso ou idioma para trás.
- B17 Estado depois de Restaurar: o aparelho volta a responder e o SSH/túnel segue vivo.

### 7.4 Decisões que faltam (não são código, são escolha)
1. "Registrar modelo" grava só no app ou grava **e** aplica?
2. "Restaurar modelo/celular" desfaz **só o modelo** ou tudo (modelo, GPS, fuso, idioma, proxy)?
3. Se o usuário digita lat/lon e depois troca a proxy, quem vence? (proposta: o digitado, até limpar)
4. Idioma "da proxy" aplica sozinho ao salvar a proxy ou só preenche o campo para confirmação?
5. O Salvar único avisa que idioma/fuso podem respringar e derrubar o CAM LIVE?

### 7.5 O que NÃO é verificável daqui
- Como a interface do iPhone renderiza o idioma e o formato de data (tela apagada; screenshots pretos).
- O `Accept-Language` que os sites recebem (sem `curl` no aparelho; só pela tela do iPhone).
- Se um app de terceiro específico aceita o idioma novo (só abrindo o app na tela).

## 8. Decisões do usuário (08/11) e o que elas exigem de teste

Respostas registradas: (1) "Registrar modelo" **grava o modelo**; (2) "Restaurar" **desfaz tudo**;
(3) lat/lon **digitado vence**; (4) idioma **preenche automático com a proxy**; (5) o Salvar
**não** avisa/respinga por causa do idioma — "salva tudo do modelo do celular, proxy, idioma…
mas o CAM LIVE continua funcionando". Extra: antes de registrar, **popup pedindo um nome**.

### 8.1 Conflito técnico da resposta 5 (o mais importante)
Hoje a interface só troca de idioma com **respring** (`kill -9` no SpringBoard), e respring
**mata os apps abertos** — inclusive o app do iPhone que está lendo o CAM LIVE. Ou seja:
"aplicar idioma + respring" e "CAM LIVE continua funcionando" **não cabem no mesmo Salvar**.

Caminho que satisfaz o pedido e é testável: **não respringar no Salvar**. O idioma gravado vale
para processos novos, então todo app aberto depois já nasce no idioma novo; só a tela inicial
(SpringBoard) fica no idioma antigo até um respring separado, opcional e avisado.
Teste C3 abaixo é exatamente essa prova. Se o usuário quiser a tela inicial em português no
mesmo clique, aí o CAM LIVE cai por definição — precisa escolher.

### 8.2 Testes novos (C)
- **C1 Popup de nome ao registrar:** o modal abre **antes** de gravar; nome é obrigatório
  (vazio/só espaço é recusado); Cancelar não grava nada; nome repetido avisa ou sufixa; depois de
  gravar, o item aparece na lista com o nome digitado; acento/espaço/emoji não quebram o arquivo;
  reiniciar o app mantém o registro.
- **C2 Registrar não aplica:** o aparelho **não muda** (modelo ativo, proxy, GPS, fuso e idioma
  iguais antes/depois); só o catálogo cresce.
- **C3 Salvar mantém o CAM LIVE:** medir PID do SpringBoard antes/depois (tem de ser o **mesmo**),
  sessão de câmera viva, e abrir um app novo para confirmar o idioma novo valendo. Se o PID mudar,
  é falha: o CAM LIVE caiu.
- **C4 Idioma automático da proxy:** escolher/trocar a proxy preenche o campo de idioma com o país
  dela; o usuário pode sobrescrever à mão; o manual vence até ele limpar.
- **C5 Lat/lon digitado vence:** digitar e salvar mantém o digitado (não a geo da proxy); limpar o
  campo volta a puxar da proxy.
- **C6 "Desfaz tudo" é mesmo tudo:** depois de Restaurar, medir item por item — modelo
  (`nova-model-control.json` enabled=false), proxy (`novaproxy proxy status` sem upstream), GPS
  (`idevicesetlocation reset`), fuso (volta ao original), idioma (volta ao original), A8 = 0
  overrides, CAM LIVE encerrado. Qualquer item que sobreviva reprova.
- **C7 Restaurar sobrevive ao KeepAlive:** `com.aquiles.novalocale` e `com.aquiles.novaproxy`
  reaplicam sozinhos; o Restaurar tem de pará-los, senão o fuso/idioma voltam no minuto seguinte.
- **C8 Salvar duas vezes:** nada muda, sem respring, sem reescrita inútil.
- **C9 Falha parcial:** se um passo falhar, os demais continuam e a tela mostra **o passo que
  falhou** — não um "ok" geral.
- **C10 A8 depois de Salvar:** 0 de 347 domínios com idioma próprio.
- **C11 Reaplicar um modelo registrado:** escolher na lista e Salvar aplica; registrar de novo
  com o mesmo nome não duplica sem avisar.

### 8.3 Duas dúvidas que ainda mudam o código
1. "Registrar modelo" grava **só o modelo** ou o conjunto todo (modelo + proxy + idioma + lat/lon)?
   Se for só o modelo, ao reaplicar o resto fica como está — e o nome serve só para achar o modelo.
2. "Desfaz tudo" inclui **encerrar o CAM LIVE**? Por definição sim (é um dos sistemas), mas o
   usuário pediu CAM LIVE vivo no Salvar; no Restaurar isso precisa ser dito na tela antes.

## 9. Correção das duas dúvidas (usuário, 08/11) — vale sobre a seção 8.3

**1) "Registrar" grava o PERFIL COMPLETO:** modelo + proxy + idioma + lat/lon.
Não é só o modelo: o registro é um retrato do que está na tela, para reaplicar depois.

**2) "Restaurar" NÃO encerra o CAM LIVE.** Desfaz modelo, proxy, GPS, idioma e fuso, mas a
transmissão de vídeo segue no ar. Isso **substitui** o que a seção 8.2 dizia (C6 "CAM LIVE
encerrado" está errado): o esperado é **injeção desligada + transmissão viva**.

### 9.1 Testes corrigidos / novos
- **C2 (corrigido) Registrar grava o conjunto:** depois de registrar, mudar tudo no aparelho
  (modelo, proxy, GPS, idioma, fuso) e aplicar o registro pelo nome → **os cinco** voltam ao do
  retrato. Falha se só o modelo voltar ou se algum campo ficar de fora do arquivo.
- **C6 (corrigido) Restaurar desfaz tudo menos o CAM LIVE:** medir depois do Restaurar —
  modelo `enabled=false`; `novaproxy proxy status` sem upstream; GPS resetado; idioma e fuso no
  original; A8 = 0/347; **e** a transmissão da câmera continua chegando ao iPhone no lugar da
  injeção. PID do SpringBoard **igual** antes/depois (se mudar, o CAM LIVE caiu: reprova).
- **C12 (novo) Prova de "transmissão viva sem injeção":** com o CAM LIVE ligado, antes e depois do
  Restaurar, verificar (a) o socket da ponte em `/var/tmp/.nbi-*.sock` existe, (b) o app do Mac
  continua servindo os frames (porta do túnel de pé), (c) no iPhone o app de câmera continua
  recebendo vídeo do Mac e não da câmera real. Só (a)+(b) já reprovam quando a transmissão cai.
- **C13 Restaurar duas vezes:** idempotente, sem respring e sem derrubar o CAM LIVE na segunda.
- **C14 Depois do Restaurar, o CAM LIVE pode ser desligado de propósito** (botão próprio
  `pararCamLive`) — aí sim a transmissão cai, e é o único caminho que derruba.

### 9.2 Método objetivo (o que eu meço, sem a tela do iPhone)
- Injeção ligada/desligada: `nova-model-control.json` + configs de injeção da câmera.
- Transmissão viva: socket `/var/tmp/.nbi-*.sock` presente + túnel/porta do Mac de pé + app de
  câmera do iPhone rodando e aberto depois.
- Respring: PID do SpringBoard antes/depois.
- Idioma: `.GlobalPreferences.plist` (lesma com `grep -a`) e A8 = 0/347.
- Fuso: `readlink /var/db/timezone/localtime` + `date`.
- Proxy: `novaproxy proxy status`.
