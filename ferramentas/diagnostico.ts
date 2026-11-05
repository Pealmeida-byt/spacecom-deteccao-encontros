/**
 * Raio-X da qualidade dos dados de cada dataset — escrito de forma simples e independente da
 * leitura otimizada (usa split), para enxergar o arquivo "como ele é": formatos encontrados,
 * linhas problemáticas, duplicatas, inconsistências e ordenação.
 *
 * Uso: node dist/ferramentas/diagnostico.js [arquivos...]   (padrão: todos os data/dataset*.txt)
 */
import { readFileSync, statSync } from 'node:fs';
import { COLUNAS_DO_ENUNCIADO } from '../src/leitura.js';
import { numero } from '../src/terminal.js';
import { listarDatasets, megabytes, nomeDoDataset } from './comum.js';

const PADRAO_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const limpar = (campo: string | undefined): string => (campo ?? '').replace(/^[ \t\r"]+|[ \t\r"]+$/g, '');

class Contador<T> {
  private readonly mapa = new Map<T, number>();
  somar(valor: T, quantidade = 1): void {
    this.mapa.set(valor, (this.mapa.get(valor) ?? 0) + quantidade);
  }
  get distintos(): number {
    return this.mapa.size;
  }
  principais(limite = 6, formatar: (v: T) => string = (v) => JSON.stringify(v)): string {
    const itens = [...this.mapa].sort((a, b) => b[1] - a[1]);
    const texto = itens.slice(0, limite).map(([v, n]) => `${formatar(v)} ${numero(n)}`);
    if (itens.length > limite) texto.push(`… +${itens.length - limite}`);
    return texto.join(' · ') || '—';
  }
  entradas(): [T, number][] {
    return [...this.mapa];
  }
}

/** O diagnóstico lê o arquivo como texto; acima disso esbarraria no limite de tamanho de string do V8. */
const LIMITE_DE_BYTES = 300 * 1024 * 1024;

function diagnosticar(caminho: string): void {
  if (statSync(caminho).size > LIMITE_DE_BYTES) {
    console.log(`\n■ ${nomeDoDataset(caminho)} — ${megabytes(statSync(caminho).size)}: grande demais para o diagnóstico (pulado)`);
    return;
  }
  const texto = readFileSync(caminho, 'utf8');
  const temBom = texto.charCodeAt(0) === 0xfeff;
  const linhas = texto.replace(/^﻿/, '').split('\n');
  if (linhas[linhas.length - 1] === '') linhas.pop();
  const comCrlf = linhas.filter((l) => l.endsWith('\r')).length;

  const cabecalho = linhas[0]?.replace(/\r$/, '') ?? '';
  const temCabecalho = Number.isNaN(Number(limpar(cabecalho.split(';')[0])));
  const dados = temCabecalho ? linhas.slice(1) : linhas;
  const cabecalhoPadrao = cabecalho === COLUNAS_DO_ENUNCIADO.join(';');

  const camposPorLinha = new Contador<number>();
  const valoresMedida = new Contador<string>();
  const valoresFaccao = new Contador<string>();
  const formatosIds = new Contador<string>();
  const timestampsForaDoPadrao = new Contador<string>();
  const exemplosInvalidos: string[] = [];
  const atributosPorPessoa = new Map<string, string>();
  const inconsistentes = new Set<string>();
  const vistos = new Map<string, string>();
  const timestamps = new Map<string, number>();
  let emBranco = 0;
  let linhasInconsistentes = 0;
  let idInvalido = 0;
  let coordenadaInvalida = 0;
  let zeroZero = 0;
  let virgulaDecimal = 0;
  let casasDiferentesDe5 = 0;
  let segundosForaDe5 = 0;
  let duplicatasExatas = 0;
  let duplicatasConflitantes = 0;
  let mudancasDeTimestamp = 0;
  let mudancasDePessoa = 0;
  let timestampAnterior = '';
  let pessoaAnterior = '';
  let foraDeOrdemNoTempo = 0;
  let latMin = Infinity;
  let latMax = -Infinity;
  let lonMin = Infinity;
  let lonMax = -Infinity;

  for (const bruta of dados) {
    const linha = bruta.replace(/\r$/, '');
    if (linha.trim() === '') {
      emBranco++;
      continue;
    }
    const campos = linha.split(';');
    camposPorLinha.somar(campos.length);
    const [id, faccao, timestamp, latTexto, lonTexto, medida, ids] = campos.map(limpar);
    if (!/^\d+$/.test(id)) {
      idInvalido++;
      if (exemplosInvalidos.length < 5) exemplosInvalidos.push(linha);
      continue;
    }
    valoresMedida.somar(medida);
    valoresFaccao.somar(faccao);
    if (ids !== '') formatosIds.somar(ids.replace(/\d+/g, 'N'));
    if (!PADRAO_TIMESTAMP.test(timestamp)) timestampsForaDoPadrao.somar(timestamp);
    else if (Number(timestamp.slice(-2)) % 5 !== 0) segundosForaDe5++;
    if (timestamp !== '') timestamps.set(timestamp, (timestamps.get(timestamp) ?? 0) + 1);

    const atributos = `${faccao}|${medida}|${ids}`;
    const anteriores = atributosPorPessoa.get(id);
    if (anteriores === undefined) atributosPorPessoa.set(id, atributos);
    else if (anteriores !== atributos) {
      inconsistentes.add(id);
      linhasInconsistentes++;
    }

    if (latTexto.includes(',') || lonTexto.includes(',')) virgulaDecimal++;
    const lat = Number(latTexto.replace(',', '.'));
    const lon = Number(lonTexto.replace(',', '.'));
    const valida = latTexto !== '' && lonTexto !== '' && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    if (!valida) {
      coordenadaInvalida++;
      if (exemplosInvalidos.length < 5) exemplosInvalidos.push(linha);
      continue;
    }
    if (lat === 0 && lon === 0) {
      zeroZero++;
      if (exemplosInvalidos.length < 5) exemplosInvalidos.push(linha);
      continue;
    }
    if ((latTexto.split(/[.,]/)[1] ?? '').length !== 5 || (lonTexto.split(/[.,]/)[1] ?? '').length !== 5) casasDiferentesDe5++;
    latMin = Math.min(latMin, lat);
    latMax = Math.max(latMax, lat);
    lonMin = Math.min(lonMin, lon);
    lonMax = Math.max(lonMax, lon);

    const chave = `${id}|${timestamp}`;
    const posicao = `${lat}|${lon}`;
    const anterior = vistos.get(chave);
    if (anterior === undefined) vistos.set(chave, posicao);
    else if (anterior === posicao) duplicatasExatas++;
    else duplicatasConflitantes++;

    if (timestamp !== timestampAnterior) {
      mudancasDeTimestamp++;
      if (timestamp < timestampAnterior) foraDeOrdemNoTempo++;
    }
    if (id !== pessoaAnterior) mudancasDePessoa++;
    timestampAnterior = timestamp;
    pessoaAnterior = id;
  }

  // Pessoas e relações.
  let vitimas = 0;
  let comFaccao = 0;
  const faccoes = new Set<string>();
  const referenciasInexistentes = new Set<string>();
  for (const [id, atributos] of atributosPorPessoa) {
    const [faccao, medida, ids] = atributos.split('|');
    const ehVitima = /^[tTsSyYvV1]/.test(medida) || ids !== '';
    if (ehVitima) vitimas++;
    if (faccao !== '' && !/^(null|none|nan|undefined|-)$/i.test(faccao)) {
      comFaccao++;
      faccoes.add(faccao.toUpperCase());
    }
    for (const alvo of ids.match(/\d+/g) ?? []) if (!atributosPorPessoa.has(alvo)) referenciasInexistentes.add(`${id}→${alvo}`);
  }
  const porTimestamp = [...timestamps.values()];
  const ordenados = [...timestamps.keys()].filter((t) => PADRAO_TIMESTAMP.test(t)).sort();
  const linhasValidas = vistos.size + duplicatasExatas + duplicatasConflitantes;
  const ordenacao =
    mudancasDeTimestamp <= timestamps.size + foraDeOrdemNoTempo
      ? foraDeOrdemNoTempo === 0
        ? 'agrupado por timestamp, em ordem cronológica'
        : 'agrupado por timestamp, fora de ordem cronológica'
      : mudancasDePessoa <= atributosPorPessoa.size
        ? 'agrupado por pessoa'
        : 'sem ordem definida';

  const aviso = (n: number): string => (n > 0 ? ` ⚠ ${numero(n)}` : ' 0');
  console.log(`\n■ ${nomeDoDataset(caminho)} — ${megabytes(statSync(caminho).size)}, ${numero(linhas.length)} linhas`);
  console.log(`  Cabeçalho: ${temCabecalho ? (cabecalhoPadrao ? 'igual ao do enunciado ✓' : `DIFERENTE ⚠ "${cabecalho}"`) : 'ausente ⚠'}`);
  console.log(`  Quebra de linha: ${comCrlf > 0 ? `\\r\\n em ${numero(comCrlf)} linhas` : '\\n'} · BOM: ${temBom ? 'sim' : 'não'} · linhas em branco:${aviso(emBranco)}`);
  console.log(`  Campos por linha: ${camposPorLinha.principais(4, (v) => String(v))}`);
  console.log(
    `  Pessoas: ${numero(atributosPorPessoa.size)} (monitorados ${numero(atributosPorPessoa.size - vitimas)} · vítimas ${numero(vitimas)})` +
      ` · com facção ${numero(comFaccao)} · facções distintas ${numero(faccoes.size)}`,
  );
  console.log(`  faccaoMonitorado: ${valoresFaccao.principais(8)}`);
  console.log(`  medidaProtetiva: ${valoresMedida.principais(8)}`);
  console.log(`  idsRestricaoMedida (formatos): ${formatosIds.principais(5)}`);
  console.log(
    `  Timestamps: ${numero(timestamps.size)} distintos` +
      (ordenados.length > 0 ? ` · de ${ordenados[0]} a ${ordenados[ordenados.length - 1]}` : '') +
      ` · fora do padrão:${aviso(timestampsForaDoPadrao.entradas().reduce((s, [, n]) => s + n, 0))}` +
      ` · segundos não múltiplos de 5:${aviso(segundosForaDe5)}`,
  );
  if (timestampsForaDoPadrao.distintos > 0) console.log(`    exemplos fora do padrão: ${timestampsForaDoPadrao.principais(5)}`);
  if (porTimestamp.length > 0) {
    const minimo = porTimestamp.reduce((a, b) => Math.min(a, b), Infinity);
    const maximo = porTimestamp.reduce((a, b) => Math.max(a, b), 0);
    console.log(
      `  Posições por timestamp: mín ${numero(minimo)} · média ${numero(Math.round(linhasValidas / porTimestamp.length))}` +
        ` · máx ${numero(maximo)}`,
    );
  }
  console.log(
    `  Coordenadas: lat [${latMin}, ${latMax}] · lon [${lonMin}, ${lonMax}] · inválidas:${aviso(coordenadaInvalida)} · (0,0):${aviso(zeroZero)}` +
      ` · vírgula decimal:${aviso(virgulaDecimal)} · casas ≠ 5:${aviso(casasDiferentesDe5)}`,
  );
  console.log(`  Duplicatas (mesma pessoa e timestamp): exatas${aviso(duplicatasExatas)} · com posição diferente${aviso(duplicatasConflitantes)}`);
  console.log(
    `  Pessoas com atributos (facção/medida/restrições) diferentes entre linhas:${aviso(inconsistentes.size)}` +
      (inconsistentes.size > 0
        ? ` em ${numero(linhasInconsistentes)} linhas (ex.: ids ${[...inconsistentes].slice(0, 5).join(', ')})`
        : ''),
  );
  console.log(`  Restrições apontando para ids inexistentes:${aviso(referenciasInexistentes.size)}${referenciasInexistentes.size > 0 ? ` (ex.: ${[...referenciasInexistentes].slice(0, 5).join(', ')})` : ''}`);
  console.log(`  Linhas com id inválido:${aviso(idInvalido)} · ordenação do arquivo: ${ordenacao}`);
  if (exemplosInvalidos.length > 0) console.log(`  Exemplos de linhas descartadas:\n${exemplosInvalidos.map((l) => `    ${JSON.stringify(l)}`).join('\n')}`);
}

const arquivos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const alvos = arquivos.length > 0 ? arquivos : listarDatasets();
if (alvos.length === 0) {
  console.error('Nenhum dataset encontrado em data/. Rode "npm run baixar".');
  process.exitCode = 1;
} else {
  console.log('Diagnóstico dos dados');
  for (const arquivo of alvos) diagnosticar(arquivo);
  console.log('');
}
