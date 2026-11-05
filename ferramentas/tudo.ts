/**
 * Pipeline completo em um comando (`npm run tudo`):
 *
 *   baixar → diagnosticar → processar → validar → conferir com força bruta → testes →
 *   benchmark → atualizar README → gerar o .zip de entrega
 *
 * Tudo o que aparece na tela também vai para relatorios/relatorio-completo.txt.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResultadoConferencia } from './conferir.js';
import { listarDatasets, PASTA_RELATORIOS, RELATORIO_CONFERENCIA, RELATORIO_PROCESSAMENTO, RELATORIO_VALIDACAO } from './comum.js';
import type { ResultadoValidacao } from './validar.js';

const LOG = join(PASTA_RELATORIOS, 'relatorio-completo.txt');
const DIAGNOSTICO = join(PASTA_RELATORIOS, 'diagnostico.txt');
const script = (relativo: string): string => fileURLToPath(new URL(relativo, import.meta.url));

function registrar(texto: string, naTela = true, destaque = false): void {
  if (naTela) process.stdout.write(destaque && process.stdout.isTTY ? `\x1b[1m${texto}\x1b[0m` : texto);
  appendFileSync(LOG, texto);
}

/** Executa um passo em outro processo Node, mostrando (ou não) a saída e guardando tudo no log. */
function executar(argumentos: string[], mostrar: boolean): Promise<{ codigo: number; saida: string }> {
  return new Promise((resolve) => {
    const processo = spawn(process.execPath, argumentos, { stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    const receber = (pedaco: Buffer): void => {
      const texto = pedaco.toString('utf8');
      saida += texto;
      registrar(texto, mostrar);
    };
    processo.stdout.on('data', receber);
    processo.stderr.on('data', receber);
    processo.on('close', (codigo) => resolve({ codigo: codigo ?? 1, saida }));
  });
}

async function principal(): Promise<void> {
  mkdirSync(PASTA_RELATORIOS, { recursive: true });
  writeFileSync(LOG, `Relatório completo — ${new Date().toLocaleString('pt-BR')} — Node ${process.version} — ${process.platform}\n`);
  const etapas = 8;
  let atual = 0;
  const titulo = (texto: string): void => registrar(`\n[${++atual}/${etapas}] ${texto}\n`, true, true);
  const problemas: string[] = [];

  registrar('\n━━━ Detecção de Encontros · Spacecom Trainee Tech 2027 · pipeline completo ━━━\n');

  titulo('Baixando os arquivos do desafio');
  const download = await executar([script('./baixar-datasets.js')], true);
  if (listarDatasets().length === 0) {
    registrar('\n✗ Nenhum dataset disponível em data/. Baixe os arquivos pelos links do e-mail, coloque em data/ e rode de novo.\n');
    process.exitCode = 1;
    return;
  }
  if (download.codigo !== 0) problemas.push('alguns arquivos não foram baixados (os que existem foram usados)');

  titulo('Raio-X dos dados');
  const diagnostico = await executar([script('./diagnostico.js')], false);
  writeFileSync(DIAGNOSTICO, diagnostico.saida);
  registrar(`  ✓ diagnóstico salvo em ${DIAGNOSTICO}\n`);

  titulo('Processando os datasets');
  const processamento = await executar([script('../src/cli.js'), '--relatorio', RELATORIO_PROCESSAMENTO], true);
  if (processamento.codigo !== 0) {
    registrar('\n✗ O processamento falhou — veja a mensagem acima.\n');
    process.exitCode = 1;
    return;
  }

  titulo('Validando com as respostas oficiais');
  const validacao = await executar([script('./validar.js')], true);
  if (validacao.codigo === 2) problemas.push('a validação encontrou divergências');
  else if (validacao.codigo !== 0) problemas.push('a validação não pôde ser feita (faltam os arquivos de respostas em data/?)');

  titulo('Conferindo com a implementação de força bruta (pode levar até 1 minuto)');
  const conferencia = await executar([script('./conferir.js')], true);
  if (conferencia.codigo !== 0) problemas.push('a conferência com a força bruta encontrou diferenças');

  titulo('Rodando os testes automatizados');
  const testes = await executar([script('./testar.js'), '--test-reporter=spec'], false);
  const passou = /ℹ pass (\d+)/.exec(testes.saida)?.[1] ?? '?';
  const falhou = /ℹ fail (\d+)/.exec(testes.saida)?.[1] ?? '?';
  registrar(`  ${testes.codigo === 0 ? '✓' : '✗'} ${passou} teste(s) passaram, ${falhou} falharam\n`);
  if (testes.codigo !== 0) problemas.push('há testes falhando');

  titulo('Medindo o tempo de execução (5 repetições por dataset — leva alguns segundos)');
  await executar([script('./benchmark.js'), '--repeticoes', '5'], true);

  titulo('Atualizando o README e gerando o .zip de entrega');
  await executar([script('./atualizar-readme.js')], true);
  const pacote = await executar([script('./empacotar.js')], true);
  if (pacote.codigo !== 0) problemas.push('o .zip não foi gerado');

  // ------------------------------------------------------------------ resumo
  registrar('\n━━━ Resumo ━━━\n');
  const validacoes = lerJson<ResultadoValidacao[]>(RELATORIO_VALIDACAO) ?? [];
  if (validacoes.length > 0) {
    const score = validacoes.reduce((s, v) => s + v.score, 0);
    const maximo = validacoes.reduce((s, v) => s + v.scoreMaximo, 0);
    registrar(`${score === maximo ? '✅' : '❌'} Validação (datasets com resposta): score ${score} de ${maximo}\n`);
  }
  const conferidos = (lerJson<ResultadoConferencia[]>(RELATORIO_CONFERENCIA) ?? []).filter((c) => c.identico !== null);
  if (conferidos.length > 0) {
    const identicos = conferidos.filter((c) => c.identico).length;
    registrar(`${identicos === conferidos.length ? '✅' : '❌'} Força bruta: ${identicos} de ${conferidos.length} datasets idênticos\n`);
  }
  registrar(`${testes.codigo === 0 ? '✅' : '❌'} Testes: ${passou} passaram, ${falhou} falharam\n`);
  const zip = /📦 (\S+\.zip)/.exec(pacote.saida)?.[1];
  if (zip) registrar(`📦 Arquivo para enviar: ${zip}\n`);
  registrar(`📝 Relatório completo: ${LOG}\n`);
  if (problemas.length > 0) {
    registrar(`\n⚠ Atenção: ${problemas.join('; ')}.\n  Mande o arquivo ${LOG} para análise antes de enviar.\n`);
    process.exitCode = 2;
  } else {
    registrar('\n✅ Tudo certo! O .zip acima está pronto para ser enviado.\n');
  }
}

function lerJson<T>(caminho: string): T | null {
  return existsSync(caminho) ? (JSON.parse(readFileSync(caminho, 'utf8')) as T) : null;
}

await principal();
