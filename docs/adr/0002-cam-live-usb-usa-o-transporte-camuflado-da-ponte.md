# O CAM LIVE por USB usa o transporte camuflado da ponte do iPhone

A partir da ponte `0.1-39`, o servidor local só responde em `/s/<token de 32 hex>/…`. O túnel USB tenta primeiro um socket Unix no iPhone e, se o `sshd` não aceitar, cai para uma porta TCP aleatória, de modo que nenhuma porta fixa (a antiga `18999`, com a rota `/frame.jpg`) fica escutando no aparelho. A ponte relata a versão `0.1-<revisão>` e o app exige `0.1-39` ou mais nova; as anteriores não têm o transporte camuflado.

O CAM LIVE assume a câmera limpando antes qualquer injeção anterior (sequestro ou vídeo local) e devolve o controle ao modo `observe` quando termina ou falha. Sem isso, um controle velho apontando para um túnel morto deixava a Câmera do iPhone preta e a transmissão seguinte não entrava.
