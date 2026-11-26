// Roda os três experimentos em sequência (nunca em paralelo, para um não
// disputar CPU e disco com o outro e distorcer as medições).
import { executar as concorrencia } from './concorrencia.js';
import { executar as indices } from './indices.js';
import { executar as paginacao } from './paginacao.js';

for (const [nome, experimento] of [['paginacao', paginacao], ['indices', indices], ['concorrencia', concorrencia]]) {
  console.log(`\n== ${nome} ==`);
  await experimento();
}
console.log('\nPronto. Abra /db-lab/ no site para ver os resultados.');
