/**
 * Caminhos e utilidades compartilhados pelas ferramentas.
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ordemNatural } from '../src/terminal.js';

export const PASTA_DADOS = 'data';
export const PASTA_SAIDA = 'output';
export const PASTA_RELATORIOS = 'relatorios';
export const PASTA_ENTREGA = 'entrega';

/** Endereço dos arquivos informado no e-mail do desafio. */
export const URL_DOS_ARQUIVOS = 'https://bucket-projeto-trainee.s3.sa-east-1.amazonaws.com';
export const ARQUIVOS_DO_DESAFIO = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => `dataset${n}.txt`),
  ...[1, 2].map((n) => `respostas${n}.json`),
];

export const RELATORIO_PROCESSAMENTO = join(PASTA_RELATORIOS, 'processamento.json');
export const RELATORIO_VALIDACAO = join(PASTA_RELATORIOS, 'validacao.json');
export const RELATORIO_BENCHMARK = join(PASTA_RELATORIOS, 'benchmark.json');
export const RELATORIO_CONFERENCIA = join(PASTA_RELATORIOS, 'conferencia.json');

/** data/dataset*.txt em ordem natural (dataset2 antes de dataset10). */
export function listarDatasets(): string[] {
  if (!existsSync(PASTA_DADOS)) return [];
  return readdirSync(PASTA_DADOS)
    .filter((nome) => /^dataset.*\.txt$/i.test(nome))
    .sort(ordemNatural)
    .map((nome) => join(PASTA_DADOS, nome));
}

export function nomeDoDataset(caminho: string): string {
  return basename(caminho).replace(/\.[^.]+$/, '');
}

export function caminhoDaSaida(dataset: string): string {
  return join(PASTA_SAIDA, `${nomeDoDataset(dataset)}.json`);
}

/** dataset1.txt → data/respostas1.json (se existir). */
export function caminhoDaResposta(dataset: string): string | null {
  const numero = /(\d+)/.exec(nomeDoDataset(dataset))?.[1];
  if (!numero) return null;
  const caminho = join(PASTA_DADOS, `respostas${numero}.json`);
  return existsSync(caminho) ? caminho : null;
}

export function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}
