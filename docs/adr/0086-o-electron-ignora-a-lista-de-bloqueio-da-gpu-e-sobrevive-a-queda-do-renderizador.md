# O Electron ignora a lista de bloqueio da GPU e sobrevive à queda do renderizador

O app liga `ignore-gpu-blocklist` e `disable-gpu-sandbox` para usar a GPU disponível mesmo em máquinas que o Chromium bloqueia. Se o processo de renderização cai (`render-process-gone`), a janela registra o motivo e, quando a saída não foi limpa, recarrega a interface após 2 segundos em vez de derrubar o processo inteiro.
