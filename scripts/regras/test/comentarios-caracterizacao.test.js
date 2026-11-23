'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { analisarJs, linhasDeComentario } = require('../comentarios');

const AMOSTRAS = [
  ['a.js', 'const a = `x ${ {b: 1}["b"] } // dentro`; // fora\nlet i = 0; i++ / 2; // depois do incremento\nconst r = /\\/\\/[/]/; /* bloco */ x\n', ['1:fora', '2:depois do incremento', '3:bloco']],
  ['a.js', '#!/usr/bin/env node\n  --> seta no começo\nx --> nao\n<!-- html\nreturn /a/ // regex depois de return\n', ['1:!/usr/bin/env node', '2:--> seta no começo', '4:html', '5:regex depois de return']],
  ['a.js', 'const t = `a${`b${c /* sim */}`}`; /* um\n * dois\n */ y\n', ['1:sim', '1:um', '2:dois', '3:']],
  ['a.js', "const a = `${ {b: 1} + '`' } // nao` // sim\n", ['1:sim']],
  ['a.css', 'a { content: "/* nao */"; } /* sim */\n', ['1:sim']],
  ['a.html', '<p title="<!-- nao -->">x</p><!-- sim -->\n<script>// js\n</script>\n<script type="text/x">// nao\n</script>\n<style>/* css */</style>\n', ['1:sim', '2:js', '6:css']],
  ['a.py', 's = "# nao"\nt = """\n# nao\n"""  # sim\nu = \'a\\\'#\'\n', ['4:sim']],
  ['a.sh', 'echo a#b # sim\necho "$(echo # sim\n)" \'# nao\' $\'\\\'# nao\'\ncat <<EOF\n# nao\nEOF\n(( x << 2 )) # sim\necho `x # sim\n` <<< "# nao"\n', ['1:sim', '2:sim', '7:sim', '8:sim']],
  ['a.sh', 'cat <<-\'FIM\' <<"OUTRO"\n\t# nao\n\tFIM\n# nao\nOUTRO\n# sim\n', ['6:sim']],
  ['a.yml', 'a: "# nao" # sim\nb: c#d\n# sim\n', ['1:sim', '3:sim']],
  ['a.bat', 'rem sim\n@echo off & rem sim\n:: sim\necho remover\n', ['1:rem sim', '2:& rem sim', '3::: sim']],
  ['ferramenta', '#!/usr/bin/env python3\n# sim\n', ['1:!/usr/bin/env python3', '2:sim']],
  ['outra', '#!/bin/bash\n# sim\n', ['1:!/bin/bash', '2:sim']],
  ['Makefile', 'all: # sim\n', ['1:sim']],
  ['a.txt', '# nao\n', []],
];

for (const [arquivo, fonte, esperado] of AMOSTRAS) {
  test(`caracterização: comentários de ${arquivo} ${JSON.stringify(fonte.slice(0, 30))}`, () => {
    assert.deepStrictEqual(linhasDeComentario(arquivo, fonte).map(({ linha, corpo }) => `${linha}:${corpo}`), esperado);
  });
}

test('caracterização: textos de JS separam o modelo da interpolação', () => {
  assert.deepStrictEqual(analisarJs(AMOSTRAS[2][1]).textos, [[11, 12], [15, 16], [30, 30], [32, 32]]);
});
