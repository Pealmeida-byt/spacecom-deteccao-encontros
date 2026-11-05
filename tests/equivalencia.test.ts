/**
 * Prova de equivalência: a versão otimizada precisa produzir EXATAMENTE o mesmo JSON que a
 * implementação de referência por força bruta (que compara todos os pares), em dezenas de
 * datasets aleatórios — limpos e com sujeira.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gerarDataset } from '../ferramentas/gerar-dataset.js';
import { detectarPorForcaBruta } from '../ferramentas/referencia-forca-bruta.js';
import { detectar } from './auxiliares.js';

test('otimizado ≡ força bruta em 60 datasets aleatórios (com e sem ruído)', () => {
  const porTipo = { generico: 0, faccao: 0, protetiva: 0 };
  for (let semente = 1; semente <= 60; semente++) {
    const texto = gerarDataset({
      semente,
      pessoas: 20 + (semente % 7) * 12,
      timestamps: 15 + (semente % 5) * 10,
      ladoAreaMetros: 120 + (semente % 4) * 120,
      fracaoVitimas: 0.15 + (semente % 3) * 0.1,
      ruido: semente % 2 === 0,
    });
    const otimizado = detectar(texto);
    const referencia = detectarPorForcaBruta(texto);
    assert.equal(JSON.stringify(otimizado), JSON.stringify(referencia), `divergência na semente ${semente}`);
    for (const e of otimizado) porTipo[e.tipo]++;
  }
  // Garante que o teste é significativo: todos os tipos aparecem em quantidade.
  assert.ok(porTipo.generico > 1000, `genéricos: ${porTipo.generico}`);
  assert.ok(porTipo.faccao > 1000, `facção: ${porTipo.faccao}`);
  assert.ok(porTipo.protetiva > 300, `protetiva: ${porTipo.protetiva}`);
});
