/**
 * Preenche a seção "Resultados" do README.md (entre os marcadores RESULTADOS) com os números
 * reais gerados por `npm run tudo`: validação, encontros por tipo, tempos e conferência.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { RelatorioProcessamento } from '../src/processar.js';
import { milissegundos, numero } from '../src/terminal.js';
import type { MedicaoBenchmark } from './benchmark.js';
import { RELATORIO_BENCHMARK, RELATORIO_CONFERENCIA, RELATORIO_PROCESSAMENTO, RELATORIO_VALIDACAO } from './comum.js';
import type { ResultadoConferencia } from './conferir.js';
import type { ResultadoValidacao } from './validar.js';

const INICIO = '<!-- RESULTADOS:INICIO -->';
const FIM = '<!-- RESULTADOS:FIM -->';

function ler<T>(caminho: string): T | null {
  return existsSync(caminho) ? (JSON.parse(readFileSync(caminho, 'utf8')) as T) : null;
}

function montarSecao(): string {
  const processamento = ler<RelatorioProcessamento[]>(RELATORIO_PROCESSAMENTO);
  const validacao = ler<ResultadoValidacao[]>(RELATORIO_VALIDACAO);
  const benchmark = ler<{ repeticoes: number; node: string; cpu: string | null; medicoes: MedicaoBenchmark[] }>(RELATORIO_BENCHMARK);
  const conferencia = ler<ResultadoConferencia[]>(RELATORIO_CONFERENCIA);
  const linhas: string[] = [];

  const ambiente = benchmark ? ` · Node ${benchmark.node}${benchmark.cpu ? ` · ${benchmark.cpu.trim()}` : ''}` : '';
  linhas.push(`> Gerado automaticamente por \`npm run tudo\` em ${new Date().toLocaleString('pt-BR')}${ambiente}.`, '');

  if (validacao && validacao.length > 0) {
    const score = validacao.reduce((s, v) => s + v.score, 0);
    const maximo = validacao.reduce((s, v) => s + v.scoreMaximo, 0);
    linhas.push(
      `**Validação com as respostas oficiais** — score ${numero(score)} de ${numero(maximo)} possíveis (Score = corretos − falsos positivos):`,
      '',
      '| Dataset | Esperados | Corretos | Falsos positivos | Não encontrados | Distâncias idênticas | Score |',
      '|---|---:|---:|---:|---:|---:|---:|',
      ...validacao.map(
        (v) =>
          `| ${v.dataset} | ${numero(v.esperados)} | ${numero(v.corretos)} | ${numero(v.falsosPositivos)} | ${numero(v.naoEncontrados)} | ` +
          `${numero(v.distanciasIdenticas)}/${numero(v.corretos)} | **${numero(v.score)} / ${numero(v.scoreMaximo)}** |`,
      ),
      '',
    );
  }

  if (processamento && processamento.length > 0) {
    const medicao = new Map((benchmark?.medicoes ?? []).map((m) => [m.dataset, m]));
    const comTempo = benchmark !== null;
    linhas.push(
      `**Encontros detectados${comTempo ? ` e tempo médio de execução (${benchmark.repeticoes} execuções)` : ''}:**`,
      '',
      `| Dataset | Posições | Pessoas | Genérico | Facção | Protetiva | Total${comTempo ? ' | Algoritmo | Processo completo' : ''} |`,
      `|---|---:|---:|---:|---:|---:|---:${comTempo ? '|---:|---:' : ''}|`,
    );
    for (const r of processamento) {
      const m = medicao.get(r.dataset);
      linhas.push(
        `| ${r.dataset} | ${numero(r.leitura.posicoesValidas)} | ${numero(r.pessoas)} | ${numero(r.encontros.generico)} | ` +
          `${numero(r.encontros.faccao)} | ${numero(r.encontros.protetiva)} | ${numero(r.encontros.total)}` +
          (comTempo ? ` | ${m ? milissegundos(m.algoritmoMedioMs) : '—'} | ${m ? milissegundos(m.processoMedioMs) : '—'}` : '') +
          ' |',
      );
    }
    if (comTempo) {
      const oficiais = processamento.map((r) => medicao.get(r.dataset)).filter((m): m is MedicaoBenchmark => m !== undefined);
      const algoritmo = oficiais.reduce((s, m) => s + m.algoritmoMedioMs, 0);
      const processo = oficiais.reduce((s, m) => s + m.processoMedioMs, 0);
      linhas.push(`| **Soma** | | | | | | | **${milissegundos(algoritmo)}** | **${milissegundos(processo)}** |`);
    }
    linhas.push('');
    linhas.push(
      '"Algoritmo" = leitura + detecção + gravação do JSON. "Processo completo" = `node dist/src/cli.js <dataset>` do zero, incluindo a inicialização do Node.',
      '',
    );

    const qualidade = processamento.flatMap((r) => {
      const d = r.leitura.descartadas;
      const descartadas = d.idInvalido + d.timestampInvalido + d.coordenadaInvalida;
      if (descartadas === 0 && r.posicoesDuplicadas === 0) return [];
      return [
        `- **${r.dataset}:** ${numero(descartadas)} linha(s) descartada(s) (id inválido ${numero(d.idInvalido)}, timestamp inválido ` +
          `${numero(d.timestampInvalido)}, coordenada inválida ${numero(d.coordenadaInvalida)}) e ${numero(r.posicoesDuplicadas)} posição(ões) repetida(s) ignorada(s).`,
      ];
    });
    linhas.push(
      qualidade.length > 0
        ? `**Qualidade dos dados** (tratada automaticamente):\n\n${qualidade.join('\n')}\n`
        : '**Qualidade dos dados:** nenhuma linha inválida ou repetida nos datasets.\n',
    );
  }

  if (conferencia && conferencia.length > 0) {
    const conferidos = conferencia.filter((c) => c.identico !== null);
    const identicos = conferidos.filter((c) => c.identico).length;
    const tempoOtimizado = new Map<string, number>();
    for (const r of processamento ?? []) tempoOtimizado.set(r.dataset, r.tempoMs.total);
    for (const m of benchmark?.medicoes ?? []) tempoOtimizado.set(m.dataset, m.algoritmoMedioMs);
    linhas.push(
      `**Conferência com a força bruta** — ${identicos === conferidos.length ? '✅' : '❌'} ${identicos} de ${conferidos.length} datasets com JSON ` +
        'idêntico ao da implementação de referência, que compara todos os pares (`npm run conferir`):',
      '',
      '| Dataset | Pares comparados pela força bruta | Força bruta | Otimizado | Mais rápido | Resultado |',
      '|---|---:|---:|---:|---:|---|',
      ...conferencia.map((c) => {
        const otimizado = tempoOtimizado.get(c.dataset);
        const fator = c.forcaBrutaMs !== null && otimizado ? `${(c.forcaBrutaMs / otimizado).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}×` : '—';
        return (
          `| ${c.dataset} | ${numero(c.pares)} | ${c.forcaBrutaMs === null ? '—' : milissegundos(c.forcaBrutaMs)} | ` +
          `${otimizado === undefined ? '—' : milissegundos(otimizado)} | ${fator} | ${c.identico === null ? 'pulado' : c.identico ? '✅ idêntico' : '❌ diferente'} |`
        );
      }),
      '',
    );
  }
  return linhas.join('\n').trimEnd();
}

const readme = readFileSync('README.md', 'utf8');
const inicio = readme.indexOf(INICIO);
const fim = readme.indexOf(FIM);
if (inicio < 0 || fim < inicio) {
  console.error('Marcadores de resultados não encontrados no README.md; nada foi alterado.');
  process.exitCode = 1;
} else {
  writeFileSync('README.md', `${readme.slice(0, inicio + INICIO.length)}\n${montarSecao()}\n${readme.slice(fim)}`);
  console.log('README.md atualizado com os resultados.');
}
