# O Nova se apresenta ao Google e ao YouTube como Firefox

O Google recusa o login quando reconhece o Electron. Por isso o app define um `User-Agent` global de Firefox e, nas sessões padrão, `persist:gemini_session` e `persist:nova_global_brain`, troca o `User-Agent` das requisições a `google.com` e `youtube.com` e apaga os cabeçalhos `sec-ch-ua*`. O custo é que a versão anunciada (Firefox 115) envelhece e o Google pode passar a recusá-la; quem trocar a versão deve trocar nos dois lugares.
