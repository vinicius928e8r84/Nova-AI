# A edição local do Mac não pede chave de ativação

Esta edição foi pedida pelo dono sem chaves de ativação nem o serviço de licença do fornecedor. Os canais `license:get-status`, `license:verify` e `license:save` continuam registrados porque a interface distribuída os chama, mas respondem um estado fixo (plano `pro`, ativo, edição `mac-local`) e nenhuma chave é lida, guardada ou enviada. Remover os canais quebraria a interface; ligar a verificação de volta exige uma decisão do dono.
