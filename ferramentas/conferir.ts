/**
 * Confere, em cada dataset, que o JSON gerado pela versão otimizada é EXATAMENTE igual ao da
 * implementação de referência por força bruta (ferramentas/referencia-forca-bruta.ts).
 *
 * Os testes já fazem isso com dados sintéticos; aqui a prova é feita com os datasets reais.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { lerDataset } from '../src/leitura.js';
import { processarArquivo } from '../src/processar.js';
import { milissegundos, numero, tabela } from '../src/terminal.js';
import { caminhoDaSaida, listarDatasets, nomeDoDataset, RELATORIO_CONFERENCIA } from './comum.js';
import { detectarPorForcaBruta } from './referencia-forca-bruta.js';

/** Acima disso (pares comparados), a força bruta levaria minutos: o dataset é pulado. */
const LIMITE_DE_PARES = 1_500_000_000;
/** A força bruta lê o arquivo como texto; acima disso esbarraria no limite de tamanho de string do V8. */
const LIMITE_DE_BYTES = 300 * 1024 * 1024;

export interface ResultadoConferencia {
  dataset: string;
  encontros: number;
  identico: boolean | null;
  forcaBrutaMs: number | null;
  pares: number;
}

function paresDaForcaBruta(dataset: string): number {
  const ds = lerDataset(dataset);
  const porTimestamp = new Int32Array(ds.timestamps.length);
  for (let i = 0; i < ds.totalPosicoes; i++) porTimestamp[ds.timestampDaPosicao[i]]++;
  let pares = 0;
  for (const m of porTimestamp) pares += (m * (m - 1)) / 2;
  return pares;
}

function conferir(dataset: string): ResultadoConferencia {
  const nome = nomeDoDataset(dataset);
  const saida = caminhoDaSaida(dataset);
  if (!existsSync(saida)) processarArquivo(dataset, saida);
  const otimizado = readFileSync(saida, 'utf8');
  const encontros = (JSON.parse(otimizado) as unknown[]).length;
  const pares = paresDaForcaBruta(dataset);
  if (pares > LIMITE_DE_PARES || statSync(dataset).size > LIMITE_DE_BYTES) {
    return { dataset: nome, encontros, identico: null, forcaBrutaMs: null, pares };
  }

  const inicio = performance.now();
  const referencia = detectarPorForcaBruta(readFileSync(dataset, 'utf8'));
  const forcaBrutaMs = performance.now() - inicio;
  const identico = JSON.stringify(referencia) === JSON.stringify(JSON.parse(otimizado));
  return { dataset: nome, encontros, identico, forcaBrutaMs, pares };
}

function principal(): void {
  const datasets = listarDatasets();
  if (datasets.length === 0) {
    console.error('Nenhum dataset encontrado em data/. Rode "npm run baixar".');
    process.exitCode = 1;
    return;
  }
  console.log('Conferência: versão otimizada × força bruta (todos os pares de cada timestamp)');
  const resultados = datasets.map((d) => {
    if (process.stdout.isTTY) process.stdout.write(`  conferindo ${nomeDoDataset(d)}…\r`);
    return conferir(d);
  });
  if (process.stdout.isTTY) process.stdout.write(`${' '.repeat(40)}\r`);
  console.log(
    `${tabela(
      [
        { titulo: 'Dataset' },
        { titulo: 'Encontros', direita: true },
        { titulo: 'Pares comparados (força bruta)', direita: true },
        { titulo: 'Tempo da força bruta', direita: true },
        { titulo: 'Resultado' },
      ],
      resultados.map((r) => [
        r.dataset,
        numero(r.encontros),
        numero(r.pares),
        r.forcaBrutaMs === null ? '—' : milissegundos(r.forcaBrutaMs),
        r.identico === null ? 'pulado (grande demais)' : r.identico ? '✓ idêntico' : '✗ DIFERENTE',
      ]),
    )}\n`,
  );
  mkdirSync(dirname(RELATORIO_CONFERENCIA), { recursive: true });
  writeFileSync(RELATORIO_CONFERENCIA, `${JSON.stringify(resultados, null, 2)}\n`);
  if (resultados.some((r) => r.identico === false)) process.exitCode = 2;
}

principal();
