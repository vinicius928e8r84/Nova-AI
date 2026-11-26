'use strict';

const regraBase = require('./regra-segredo');
const { achadosDeConstante } = require('./constante-de-segredo');

const chaveDoAchado = ({ arquivo, linha }) => `${arquivo}:${linha}`;

function verificar(ctx) {
  const achados = regraBase.verificar(ctx);
  const jaMarcados = new Set(achados.map(chaveDoAchado));
  const deConstante = achadosDeConstante(ctx).filter(achado => !jaMarcados.has(chaveDoAchado(achado)));
  return [...achados, ...deConstante];
}

module.exports = { ...regraBase, verificar };
