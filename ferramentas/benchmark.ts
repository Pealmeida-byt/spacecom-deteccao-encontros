/**
 * Mede o tempo médio de execução por dataset — o critério de desempate do desafio.
 *
 * Duas medidas, para cada dataset:
 *   - algoritmo: leitura + detecção + gravação do JSON, no mesmo processo (N repetições);
 *   - processo completo: `node dist/src/cli.js <dataset>` do zero, como um avaliador rodaria
 *     (inclui os ~40 ms de inicialização do próprio Node).
 *
 * Uso: node dist/ferramentas/benchmark.js [--repeticoes N] [--sintetico]
 *   --sintetico  inclui um dataset gerado com ~1 milhão de linhas (teste de escala)
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { processarArquivo } from '../src/processar.js';
import { milissegundos, numero, tabela } from '../src/terminal.js';
import { listarDatasets, megabytes, nomeDoDataset, RELATORIO_BENCHMARK } from './comum.js';
import { gerarDataset } from './gerar-dataset.js';

export interface MedicaoBenchmark {
  dataset: string;
  tamanhoBytes: number;
  posicoes: number;
  encontros: number;
  algoritmoMedioMs: number;
  algoritmoMinimoMs: number;
  processoMedioMs: number;
}

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function medir(dataset: string, nome: string, repeticoes: number, pastaTemporaria: string): MedicaoBenchmark {
  const saida = join(pastaTemporaria, `${nome}.json`);
  const tempos: number[] = [];
  let ultimo = processarArquivo(dataset, saida);
  for (let r = 0; r < repeticoes; r++) {
    ultimo = processarArquivo(dataset, saida);
    tempos.push(ultimo.tempoMs.total);
  }
  const processos: number[] = [];
  for (let r = 0; r < repeticoes; r++) {
    const inicio = performance.now();
    const execucao = spawnSync(process.execPath, [CLI, dataset, '--saida', pastaTemporaria, '--silencioso'], { stdio: 'ignore' });
    processos.push(performance.now() - inicio);
    if (execucao.status !== 0) throw new Error(`A execução de ${nome} falhou (código ${execucao.status})`);
  }
  const media = (valores: number[]): number => valores.reduce((s, v) => s + v, 0) / valores.length;
  return {
    dataset: nome,
    tamanhoBytes: statSync(dataset).size,
    posicoes: ultimo.leitura.posicoesValidas,
    encontros: ultimo.encontros.total,
    algoritmoMedioMs: media(tempos),
    algoritmoMinimoMs: Math.min(...tempos),
    processoMedioMs: media(processos),
  };
}

function principal(): void {
  const argumentos = process.argv.slice(2);
  const indice = argumentos.indexOf('--repeticoes');
  const repeticoes = indice >= 0 ? Math.max(1, Number(argumentos[indice + 1]) || 10) : 10;
  const pastaTemporaria = mkdtempSync(join(tmpdir(), 'encontros-benchmark-'));

  try {
    const alvos = listarDatasets().map((caminho) => ({ caminho, nome: nomeDoDataset(caminho) }));
    if (argumentos.includes('--sintetico')) {
      const caminho = join(pastaTemporaria, 'sintetico.txt');
      writeFileSync(caminho, gerarDataset({ semente: 2027, pessoas: 500, timestamps: 2000, ladoAreaMetros: 3000 }));
      alvos.push({ caminho, nome: 'sintético (~1 mi de linhas)' });
    }
    if (alvos.length === 0) {
      console.error('Nenhum dataset encontrado em data/. Rode "npm run baixar" (ou use --sintetico).');
      process.exitCode = 1;
      return;
    }

    console.log(`Benchmark · ${repeticoes} repetições por dataset · Node ${process.version} · ${cpus()[0]?.model ?? 'CPU desconhecida'}`);
    const medicoes = alvos.map(({ caminho, nome }) => {
      if (process.stdout.isTTY) process.stdout.write(`  medindo ${nome}…\r`);
      return medir(caminho, nome, repeticoes, pastaTemporaria);
    });
    if (process.stdout.isTTY) process.stdout.write(`${' '.repeat(50)}\r`);
    console.log(
      `${tabela(
        [
          { titulo: 'Dataset' },
          { titulo: 'Tamanho', direita: true },
          { titulo: 'Posições', direita: true },
          { titulo: 'Encontros', direita: true },
          { titulo: 'Algoritmo (média)', direita: true },
          { titulo: 'Algoritmo (mín.)', direita: true },
          { titulo: 'Processo completo', direita: true },
        ],
        medicoes.map((m) => [
          m.dataset,
          megabytes(m.tamanhoBytes),
          numero(m.posicoes),
          numero(m.encontros),
          milissegundos(m.algoritmoMedioMs),
          milissegundos(m.algoritmoMinimoMs),
          milissegundos(m.processoMedioMs),
        ]),
      )}`,
    );
    const oficiais = medicoes.filter((m) => !m.dataset.startsWith('sintético'));
    const soma = (campo: 'algoritmoMedioMs' | 'processoMedioMs'): number => oficiais.reduce((s, m) => s + m[campo], 0);
    if (oficiais.length > 0) {
      console.log(
        `\nSoma dos tempos médios (${oficiais.length} datasets): algoritmo ${milissegundos(soma('algoritmoMedioMs'))}` +
          ` · processo completo ${milissegundos(soma('processoMedioMs'))}\n`,
      );
    }

    mkdirSync(dirname(RELATORIO_BENCHMARK), { recursive: true });
    writeFileSync(
      RELATORIO_BENCHMARK,
      `${JSON.stringify({ repeticoes, node: process.version, cpu: cpus()[0]?.model ?? null, plataforma: process.platform, medicoes }, null, 2)}\n`,
    );
  } finally {
    rmSync(pastaTemporaria, { recursive: true, force: true });
  }
}

principal();
