# O Wi-Fi e o Bluetooth do iPhone são ligados por Atalhos com nome fixo

O Nova liga e desliga o Wi-Fi e o Bluetooth do iPhone disparando, por `uiopen` pelo SSH, um Atalho nativo do iOS. O iPhone precisa ter quatro Atalhos com estes nomes exatos: `Nova WiFi On`, `Nova WiFi Off`, `Nova BT On` e `Nova BT Off` (ações "Definir Wi-Fi" e "Definir Bluetooth"). O nome é o contrato: renomear um Atalho no aparelho quebra o botão sem erro visível. O estado real pode ser lido pelo `novactl` (`com.aquiles.novactl`); o passo a passo está em `MAC/integracao-iphone/CONTROLS-IPHONE-WIFI-BLUETOOTH.md`.
