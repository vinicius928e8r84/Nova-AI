# A aba "Identidade simulada" do iPhone segue as cinco regras do dono (08/11)

O comportamento da aba, aplicado ao bundle por `aplicar-identidade.py`, vem de cinco respostas do dono em 08/11:

1. **Registrar modelo** grava o modelo (aplica no aparelho) e guarda o perfil com um nome digitado num popup.
2. **Restaurar celular** desfaz tudo (modelo, proxy, GPS, fuso e idioma), sem reiniciar o aparelho.
3. A coordenada **digitada** vence a que veio da proxy.
4. O **idioma** é preenchido automaticamente com o país da proxy, mas nunca é aplicado sozinho.
5. **Salvar** sobe tudo (modelo, proxy, GPS, fuso e idioma) **sem derrubar o CAM LIVE**: o idioma vai sem respring, e a interface do iPhone só muda quando ele pedir depois.

Idioma é do **aparelho inteiro** (todos os apps), como proxy, GPS e modelo; por isso a tela pede confirmação explícita antes de aplicar no domínio global (o contrato do backend é `confirmGlobal: true`; as regras do módulo estão no ADR 0011). Se os canais `spoofer:get-language`, `spoofer:apply-language` e `spoofer:revert-language` não existirem no app, a tela não quebra: mostra "recurso ainda não ligado no app".
