# Um relógio do host e uma única fonte mestre por grafo

O caminho `Synchronizer→VideoCompressor→RemoteQueue`, que leva a prévia para os clientes, só roda depois que o grafo tem um relógio mestre. Quem fornece esse relógio é o nó físico, que num grafo redirecionado nunca inicia. A fonte adiada herda o relógio de `BWSourceNode`, que devolve nil, e como o pipeline agenda a apresentação contra o relógio da fonte, relógio nil deixa as amostras emitidas guardadas para sempre: viewfinder preto sem nenhum descarte (sonda 0.1-7, 26/10).

Os nós redirecionados e a subclasse da fonte adiada devolvem o relógio do host, o mesmo domínio que carimba as amostras que produzimos.

O `BWCrossoverNode` só repassa amostras cuja metadado marca o fluxo sincronizado como mestre. Por isso elegemos exatamente uma fonte de software por grafo; as entradas físicas frontal e traseira não podem virar mestre as duas.
