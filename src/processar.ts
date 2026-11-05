/**
 * Processa um arquivo de ponta a ponta (ler → detectar → gravar) medindo o tempo de cada etapa.
 */
import { mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { detectarEncontros } from './detector.js';
import { lerDataset, type EstatisticasLeitura } from './leitura.js';
import { gravarEncontros } from './saida.js';
import type { TipoEncontro } from './tipos.js';

export interface RelatorioProcessamento {
  dataset: string;
  arquivoEntrada: string;
  arquivoSaida: string;
  leitura: EstatisticasLeitura;
  pessoas: number;
  vitimas: number;
  timestamps: number;
  posicoesDuplicadas: number;
  distanciasCalculadas: number;
  encontros: Record<TipoEncontro, number> & { total: number };
  tempoMs: { leitura: number; deteccao: number; escrita: number; total: number };
}

export function processarArquivo(arquivoEntrada: string, arquivoSaida: string): RelatorioProcessamento {
  const inicio = performance.now();
  const ds = lerDataset(arquivoEntrada);
  const lido = performance.now();
  const resultado = detectarEncontros(ds);
  const detectado = performance.now();
  mkdirSync(dirname(arquivoSaida), { recursive: true });
  gravarEncontros(arquivoSaida, ds, resultado.encontros);
  const fim = performance.now();

  const encontros = { total: resultado.encontros.length, generico: 0, faccao: 0, protetiva: 0 };
  for (const e of resultado.encontros) encontros[e.tipo]++;

  let vitimas = 0;
  for (let i = 0; i < ds.ehVitima.length; i++) vitimas += ds.ehVitima[i];

  return {
    dataset: basename(arquivoEntrada).replace(/\.[^.]+$/, ''),
    arquivoEntrada,
    arquivoSaida,
    leitura: ds.estatisticas,
    pessoas: ds.pessoas.length,
    vitimas,
    timestamps: ds.timestamps.length,
    posicoesDuplicadas: resultado.posicoesDuplicadas,
    distanciasCalculadas: resultado.distanciasCalculadas,
    encontros,
    tempoMs: {
      leitura: lido - inicio,
      deteccao: detectado - lido,
      escrita: fim - detectado,
      total: fim - inicio,
    },
  };
}
