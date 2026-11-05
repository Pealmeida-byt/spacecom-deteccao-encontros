/**
 * Linha de comando.
 *
 *   node dist/src/cli.js                         processa todos os data/dataset*.txt
 *   node dist/src/cli.js data/dataset3.txt       processa só os arquivos informados
 *
 * Opções:
 *   --saida <pasta>       onde gravar os JSONs (padrão: output)
 *   --relatorio <arquivo> grava também um resumo em JSON (usado pelas ferramentas)
 *   --silencioso          não imprime a tabela
 *
 * Cada entrada <nome>.txt gera <pasta de saída>/<nome>.json.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { processarArquivo, type RelatorioProcessamento } from './processar.js';
import { milissegundos, numero, ordemNatural, tabela } from './terminal.js';

interface Opcoes {
  arquivos: string[];
  pastaSaida: string;
  relatorio: string | null;
  silencioso: boolean;
}

function lerOpcoes(argumentos: string[]): Opcoes {
  const opcoes: Opcoes = { arquivos: [], pastaSaida: 'output', relatorio: null, silencioso: false };
  for (let i = 0; i < argumentos.length; i++) {
    const arg = argumentos[i];
    if (arg === '--saida') opcoes.pastaSaida = exigirValor(argumentos, ++i, arg);
    else if (arg === '--relatorio') opcoes.relatorio = exigirValor(argumentos, ++i, arg);
    else if (arg === '--silencioso') opcoes.silencioso = true;
    else if (arg === '--ajuda' || arg === '-h' || arg === '--help') {
      console.log('Uso: node dist/src/cli.js [arquivos.txt...] [--saida pasta] [--relatorio arquivo.json] [--silencioso]');
      process.exit(0);
    } else if (arg.startsWith('--')) {
      throw new Error(`Opção desconhecida: ${arg}`);
    } else opcoes.arquivos.push(arg);
  }
  if (opcoes.arquivos.length === 0) opcoes.arquivos = datasetsPadrao();
  return opcoes;
}

function exigirValor(argumentos: string[], indice: number, opcao: string): string {
  const valor = argumentos[indice];
  if (valor === undefined || valor.startsWith('--')) throw new Error(`Faltou o valor de ${opcao}`);
  return valor;
}

function datasetsPadrao(): string[] {
  const pasta = 'data';
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta)
    .filter((nome) => /^dataset.*\.txt$/i.test(nome))
    .sort(ordemNatural)
    .map((nome) => join(pasta, nome));
}

function imprimirResumo(relatorios: readonly RelatorioProcessamento[], pastaSaida: string): void {
  console.log('\nDetecção de encontros · Spacecom Trainee Tech 2027\n');
  console.log(
    tabela(
      [
        { titulo: 'Dataset' },
        { titulo: 'Posições', direita: true },
        { titulo: 'Pessoas', direita: true },
        { titulo: 'Genérico', direita: true },
        { titulo: 'Facção', direita: true },
        { titulo: 'Protetiva', direita: true },
        { titulo: 'Total', direita: true },
        { titulo: 'Tempo', direita: true },
      ],
      relatorios.map((r) => [
        r.dataset,
        numero(r.leitura.posicoesValidas),
        numero(r.pessoas),
        numero(r.encontros.generico),
        numero(r.encontros.faccao),
        numero(r.encontros.protetiva),
        numero(r.encontros.total),
        milissegundos(r.tempoMs.total),
      ]),
    ),
  );

  const avisos = relatorios.flatMap((r) => {
    const d = r.leitura.descartadas;
    const descartadas = d.idInvalido + d.timestampInvalido + d.coordenadaInvalida;
    const partes: string[] = [];
    if (descartadas > 0) {
      partes.push(
        `${numero(descartadas)} linha(s) descartada(s) (id inválido: ${numero(d.idInvalido)}, ` +
          `timestamp inválido: ${numero(d.timestampInvalido)}, coordenada inválida: ${numero(d.coordenadaInvalida)})`,
      );
    }
    if (r.posicoesDuplicadas > 0) partes.push(`${numero(r.posicoesDuplicadas)} posição(ões) repetida(s) ignorada(s)`);
    return partes.length > 0 ? [`  • ${r.dataset}: ${partes.join('; ')}`] : [];
  });
  if (avisos.length > 0) console.log(`\nQualidade dos dados:\n${avisos.join('\n')}`);

  const tempoTotal = relatorios.reduce((soma, r) => soma + r.tempoMs.total, 0);
  console.log(`\nTempo total: ${milissegundos(tempoTotal)} · resultados em ${pastaSaida}${pastaSaida.endsWith('/') ? '' : '/'}\n`);
}

function principal(): void {
  const opcoes = lerOpcoes(process.argv.slice(2));
  if (opcoes.arquivos.length === 0) {
    console.error('Nenhum dataset encontrado em data/. Rode "npm run baixar" ou informe o caminho do arquivo .txt.');
    process.exitCode = 1;
    return;
  }

  const relatorios: RelatorioProcessamento[] = [];
  for (const arquivo of opcoes.arquivos) {
    if (!existsSync(arquivo)) throw new Error(`Arquivo não encontrado: ${arquivo}`);
    const saida = join(opcoes.pastaSaida, `${basename(arquivo).replace(/\.[^.]+$/, '')}.json`);
    relatorios.push(processarArquivo(arquivo, saida));
  }

  if (!opcoes.silencioso) imprimirResumo(relatorios, opcoes.pastaSaida);
  if (opcoes.relatorio) {
    mkdirSync(dirname(opcoes.relatorio), { recursive: true });
    writeFileSync(opcoes.relatorio, `${JSON.stringify(relatorios, null, 2)}\n`);
  }
}

try {
  principal();
} catch (erro) {
  console.error(`Erro: ${erro instanceof Error ? erro.message : String(erro)}`);
  process.exitCode = 1;
}
