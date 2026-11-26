# A troca de grafo exige concessão curta e para em quatro contextos

A substituição de grafo é experimental e só vale para clientes de câmera escolhidos. Nada muda no grafo antes de haver uma concessão (`lease`) curta, e um pedido do OBS que falha não emite nada.

Uma falha na construção do grafo pode causar novas tentativas rápidas; sem limite, o `mediaserverd` acabaria com centenas de grafos e nós de software vivos. O `Tweak.x` aceita no máximo quatro contextos ao mesmo tempo (`g_contexts`), e o quinto pedido marca o gancho como falho e devolve nil.

Para as sessões que não são redirecionadas, o comportamento não muda. Num grafo redirecionado, quando o contrato é violado paramos a injeção e deixamos a violação aparecer, em vez de permitir uma exceção sem tratamento que reinicie o `mediaserverd` em ciclo.
