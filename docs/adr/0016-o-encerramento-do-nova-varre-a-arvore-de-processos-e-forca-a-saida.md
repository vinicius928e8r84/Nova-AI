# O encerramento do Nova varre a árvore de processos e força a saída

Ao encerrar, o Nova encerra os processos que iniciou, seguindo a árvore a partir dele e guardando a identidade de cada filho visto antes de o pai sair (depois disso o `launchd` os adota e a ligação some). Como um daemon como o ADB pode se reparentar ao `launchd` antes de o encerramento começar, há também uma varredura de órfãos. Os auxiliares do próprio Electron ficam de fora porque ele os fecha quando o processo principal sai.

Depois do `app.quit()`, um temporizador de 1,5 s encerra o resto e chama `app.exit(0)`, porque um renderer pode vetar a saída normal (por exemplo, com `beforeunload`).
