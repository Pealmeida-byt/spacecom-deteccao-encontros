/**
 * Validação contra as respostas oficiais (datasets 1 e 2), com a métrica do desafio:
 *
 *     Score = encontros corretos − encontros incorretos (falsos positivos)
 *
 * Um encontro é considerado o mesmo quando bate tipo + par de ids (em qualquer ordem) + timestamp.
 * Além do placar, a ferramenta confere distâncias e posições e, se houver divergência, explica o
 * motivo provável de cada caso (para corrigir rápido) e mostra o perfil dos pares esperados por
 * categoria — o que confirma, com os dados oficiais, a interpretação das regras.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { distanciaHaversine } from '../src/geo.js';
import { lerDataset, type Dataset } from '../src/leitura.js';
import { processarArquivo } from '../src/processar.js';
import { criarClassificador, type Classificador } from '../src/regras.js';
import { numero, tabela } from '../src/terminal.js';
import { caminhoDaResposta, caminhoDaSaida, listarDatasets, nomeDoDataset, RELATORIO_VALIDACAO } from './comum.js';

interface Item {
  tipo: string;
  idA: number;
  idB: number;
  timestamp: string;
  distancia: number | null;
  posicoes: Record<string, { lat: number; lon: number }> | null;
}

export interface ResultadoValidacao {
  dataset: string;
  esperados: number;
  encontrados: number;
  corretos: number;
  falsosPositivos: number;
  naoEncontrados: number;
  score: number;
  scoreMaximo: number;
  porTipo: Record<string, { esperados: number; encontrados: number; corretos: number }>;
  distanciasIdenticas: number;
  maiorDiferencaDistancia: number;
  posicoesIdenticas: number;
  duplicadosNaResposta: number;
}

const chaveCompleta = (i: Item): string => `${i.tipo}|${i.idA}|${i.idB}|${i.timestamp}`;
const chaveDoPar = (i: Item): string => `${i.idA}|${i.idB}|${i.timestamp}`;

function normalizarTipo(tipo: unknown): string {
  return String(tipo ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

function normalizar(bruto: unknown): Item | null {
  if (typeof bruto !== 'object' || bruto === null) return null;
  const o = bruto as Record<string, unknown>;
  const ids = Array.isArray(o.monitoradosEncontro) ? o.monitoradosEncontro.map(Number) : [];
  if (ids.length !== 2 || ids.some((id) => !Number.isFinite(id))) return null;
  const [idA, idB] = ids[0] < ids[1] ? [ids[0], ids[1]] : [ids[1], ids[0]];
  const posicoes =
    typeof o.posicoes === 'object' && o.posicoes !== null ? (o.posicoes as Record<string, { lat: number; lon: number }>) : null;
  return {
    tipo: normalizarTipo(o.tipo),
    idA,
    idB,
    timestamp: String(o.timestamp ?? '').trim(),
    distancia: typeof o.distanciaMetros === 'number' ? o.distanciaMetros : null,
    posicoes,
  };
}

function carregar(caminho: string): Item[] {
  const conteudo: unknown = JSON.parse(readFileSync(caminho, 'utf8'));
  const lista = Array.isArray(conteudo) ? conteudo : [];
  return lista.map(normalizar).filter((i): i is Item => i !== null);
}

/** Contexto para explicar divergências: posição de cada pessoa em cada timestamp. */
class Contexto {
  private readonly indiceDoTimestamp = new Map<string, number>();
  private readonly primeiraPosicao = new Map<number, number>();
  readonly classificar: Classificador;

  constructor(readonly ds: Dataset) {
    ds.timestamps.forEach((texto, indice) => this.indiceDoTimestamp.set(texto, indice));
    const totalPessoas = ds.pessoas.length;
    for (let i = 0; i < ds.totalPosicoes; i++) {
      const chave = ds.timestampDaPosicao[i] * totalPessoas + ds.pessoaDaPosicao[i];
      if (!this.primeiraPosicao.has(chave)) this.primeiraPosicao.set(chave, i);
    }
    this.classificar = criarClassificador(ds);
  }

  categoria(pessoaA: number, pessoaB: number): string {
    const { ehVitima, faccaoDaPessoa } = this.ds;
    const comMedida = this.classificar(pessoaA, pessoaB) === 'protetiva';
    const vitimaA = ehVitima[pessoaA] === 1;
    const vitimaB = ehVitima[pessoaB] === 1;
    if (vitimaA || vitimaB) {
      if (comMedida) return 'vítima × seu agressor';
      if (vitimaA && vitimaB) return 'vítima × vítima';
      return 'vítima × monitorado que não é seu agressor';
    }
    if (comMedida) return 'monitorado × monitorado com medida protetiva';
    const fa = faccaoDaPessoa[pessoaA];
    const fb = faccaoDaPessoa[pessoaB];
    if (fa !== -1 && fa === fb) return 'monitorado × monitorado da mesma facção';
    if (fa !== -1 && fb !== -1) return 'monitorado × monitorado de facções diferentes';
    return 'monitorado × monitorado (um ou os dois sem facção)';
  }

  pessoas(item: Item): [number, number] | null {
    const a = this.ds.indicePorId.get(item.idA);
    const b = this.ds.indicePorId.get(item.idB);
    return a === undefined || b === undefined ? null : [a, b];
  }

  /**
   * Explica uma divergência. `lado = 'esperado'`: está na resposta oficial e não geramos.
   * `lado = 'nosso'`: geramos, mas não está na resposta oficial.
   * Formato: "motivo: categoria do par (detalhes)" — o resumo agrupa por "motivo: categoria".
   */
  explicar(item: Item, lado: 'esperado' | 'nosso'): string {
    const pessoas = this.pessoas(item);
    if (!pessoas) return 'um dos ids não existe no dataset';
    const [a, b] = pessoas;
    const categoria = this.categoria(a, b);
    const t = this.indiceDoTimestamp.get(item.timestamp);
    if (t === undefined) return `timestamp não existe no dataset (ou todas as linhas dele foram descartadas): ${categoria}`;
    const totalPessoas = this.ds.pessoas.length;
    const posA = this.primeiraPosicao.get(t * totalPessoas + a);
    const posB = this.primeiraPosicao.get(t * totalPessoas + b);
    if (posA === undefined || posB === undefined) {
      return `sem posição válida de uma das pessoas nesse timestamp (linha descartada?): ${categoria}`;
    }
    const { latitude, longitude } = this.ds;
    const distancia = distanciaHaversine(latitude[posA], longitude[posA], latitude[posB], longitude[posB]);
    const detalhe = `(distância pela nossa leitura: ${distancia.toFixed(3)} m)`;
    if (lado === 'nosso') return `não consta na resposta oficial: ${categoria} ${detalhe}`;
    const tipo = this.classificar(a, b);
    if (!(distancia < 20)) return `distância ≥ 20 m pela nossa leitura: ${categoria} ${detalhe}`;
    if (tipo === null) return `nossa regra não considera encontro: ${categoria} ${detalhe}`;
    if (tipo !== item.tipo) return `classificamos como "${tipo}": ${categoria} ${detalhe}`;
    return `deveria ter sido detectado — investigar: ${categoria} ${detalhe}`;
  }
}

const VARIANTES_DE_HAVERSINE: Record<string, (a1: number, o1: number, a2: number, o2: number) => number> = {
  'clássica (atan2, diferença em graus)': (a1, o1, a2, o2) => distanciaHaversine(a1, o1, a2, o2),
  'asin, diferença em graus': (a1, o1, a2, o2) => {
    const r = (g: number): number => (g * Math.PI) / 180;
    const a = Math.sin(r(a2 - a1) / 2) ** 2 + Math.cos(r(a1)) * Math.cos(r(a2)) * Math.sin(r(o2 - o1) / 2) ** 2;
    return 6_371_000 * 2 * Math.asin(Math.sqrt(a));
  },
  'atan2, diferença em radianos': (a1, o1, a2, o2) => {
    const r = (g: number): number => (g * Math.PI) / 180;
    const a = Math.sin((r(a2) - r(a1)) / 2) ** 2 + Math.cos(r(a1)) * Math.cos(r(a2)) * Math.sin((r(o2) - r(o1)) / 2) ** 2;
    return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },
  'atan2, sin·sin em vez de sin²': (a1, o1, a2, o2) => {
    const f1 = (a1 * Math.PI) / 180;
    const f2 = (a2 * Math.PI) / 180;
    const df = ((a2 - a1) * Math.PI) / 180;
    const dl = ((o2 - o1) * Math.PI) / 180;
    const a = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },
};

function validar(dataset: string, arquivoResposta: string): ResultadoValidacao {
  const nome = nomeDoDataset(dataset);
  const saida = caminhoDaSaida(dataset);
  if (!existsSync(saida)) processarArquivo(dataset, saida);

  const esperadosLista = carregar(arquivoResposta);
  const nossos = carregar(saida);
  const esperados = new Map<string, Item>();
  let duplicadosNaResposta = 0;
  for (const item of esperadosLista) {
    if (esperados.has(chaveCompleta(item))) duplicadosNaResposta++;
    else esperados.set(chaveCompleta(item), item);
  }
  const encontrados = new Map(nossos.map((i) => [chaveCompleta(i), i]));
  const paresEncontrados = new Map(nossos.map((i) => [chaveDoPar(i), i]));
  const paresEsperados = new Map([...esperados.values()].map((i) => [chaveDoPar(i), i]));

  const corretos: [Item, Item][] = [];
  const naoEncontrados: Item[] = [];
  for (const [chave, item] of esperados) {
    const nosso = encontrados.get(chave);
    if (nosso) corretos.push([item, nosso]);
    else naoEncontrados.push(item);
  }
  const falsosPositivos = [...encontrados.values()].filter((i) => !esperados.has(chaveCompleta(i)));

  const porTipo: ResultadoValidacao['porTipo'] = {};
  const contar = (tipo: string, campo: 'esperados' | 'encontrados' | 'corretos'): void => {
    porTipo[tipo] ??= { esperados: 0, encontrados: 0, corretos: 0 };
    porTipo[tipo][campo]++;
  };
  for (const i of esperados.values()) contar(i.tipo, 'esperados');
  for (const i of encontrados.values()) contar(i.tipo, 'encontrados');
  for (const [i] of corretos) contar(i.tipo, 'corretos');

  let distanciasIdenticas = 0;
  let maiorDiferencaDistancia = 0;
  let posicoesIdenticas = 0;
  for (const [esperado, nosso] of corretos) {
    if (esperado.distancia !== null && nosso.distancia !== null) {
      const diferenca = Math.abs(esperado.distancia - nosso.distancia);
      if (diferenca === 0) distanciasIdenticas++;
      maiorDiferencaDistancia = Math.max(maiorDiferencaDistancia, diferenca);
    }
    if (JSON.stringify(ordenarPosicoes(esperado.posicoes)) === JSON.stringify(ordenarPosicoes(nosso.posicoes))) posicoesIdenticas++;
  }

  const resultado: ResultadoValidacao = {
    dataset: nome,
    esperados: esperados.size,
    encontrados: encontrados.size,
    corretos: corretos.length,
    falsosPositivos: falsosPositivos.length,
    naoEncontrados: naoEncontrados.length,
    score: corretos.length - falsosPositivos.length,
    scoreMaximo: esperados.size,
    porTipo,
    distanciasIdenticas,
    maiorDiferencaDistancia,
    posicoesIdenticas,
    duplicadosNaResposta,
  };

  // ---------------------------------------------------------------- relatório
  const perfeito = resultado.score === resultado.scoreMaximo && resultado.naoEncontrados === 0;
  console.log(`\n${perfeito ? '✅' : '❌'} ${nome} × ${arquivoResposta}`);
  console.log(
    `   Esperados ${numero(resultado.esperados)} · encontrados ${numero(resultado.encontrados)} · corretos ${numero(resultado.corretos)} · ` +
      `falsos positivos ${numero(resultado.falsosPositivos)} · não encontrados ${numero(resultado.naoEncontrados)}`,
  );
  console.log(`   Score ${numero(resultado.score)} de ${numero(resultado.scoreMaximo)} possíveis`);
  console.log(
    `   Por tipo: ${Object.entries(porTipo)
      .map(([tipo, c]) => `${tipo} ${numero(c.corretos)}/${numero(c.esperados)}`)
      .join(' · ')}`,
  );
  if (corretos.length > 0) {
    console.log(
      `   Distâncias idênticas: ${numero(distanciasIdenticas)}/${numero(corretos.length)} (maior diferença: ${maiorDiferencaDistancia} m)` +
        ` · posições idênticas: ${numero(posicoesIdenticas)}/${numero(corretos.length)}`,
    );
  }
  if (duplicadosNaResposta > 0) console.log(`   ⚠ a própria resposta oficial tem ${duplicadosNaResposta} item(ns) repetido(s)`);

  const precisaDiagnostico = !perfeito || distanciasIdenticas < corretos.length;
  if (precisaDiagnostico) {
    const contexto = new Contexto(lerDataset(dataset));

    const tiposTrocados = naoEncontrados.filter((i) => paresEncontrados.has(chaveDoPar(i)));
    if (tiposTrocados.length > 0) {
      const resumo = new Map<string, number>();
      for (const i of tiposTrocados) {
        const chave = `${i.tipo} → nós: ${paresEncontrados.get(chaveDoPar(i))?.tipo}`;
        resumo.set(chave, (resumo.get(chave) ?? 0) + 1);
      }
      console.log(`   ⚠ Mesmo par e timestamp, tipo diferente (esperado → nosso): ${[...resumo].map(([k, v]) => `${k} (${v})`).join(', ')}`);
    }
    mostrarExemplos('Não encontrados (esperados que não geramos)', naoEncontrados, contexto, paresEncontrados, 'esperado');
    mostrarExemplos('Falsos positivos (geramos, mas não estão na resposta)', falsosPositivos, contexto, paresEsperados, 'nosso');

    // Perfil dos pares por categoria: mostra qual regra a resposta oficial segue.
    const perfil = new Map<string, Map<string, number>>();
    const somar = (categoria: string, coluna: string): void => {
      let linha = perfil.get(categoria);
      if (!linha) perfil.set(categoria, (linha = new Map()));
      linha.set(coluna, (linha.get(coluna) ?? 0) + 1);
    };
    for (const i of esperados.values()) {
      const p = contexto.pessoas(i);
      somar(p ? contexto.categoria(...p) : 'id inexistente', `esperado:${i.tipo}`);
    }
    for (const i of encontrados.values()) {
      const p = contexto.pessoas(i);
      somar(p ? contexto.categoria(...p) : 'id inexistente', `nosso:${i.tipo}`);
    }
    const colunas = [...new Set([...perfil.values()].flatMap((m) => [...m.keys()]))].sort();
    console.log('\n   Perfil dos pares por categoria (esperado × nosso):');
    console.log(
      tabela(
        [{ titulo: 'Categoria do par' }, ...colunas.map((c) => ({ titulo: c, direita: true }))],
        [...perfil].map(([categoria, linha]) => [categoria, ...colunas.map((c) => numero(linha.get(c) ?? 0))]),
      )
        .split('\n')
        .map((l) => `   ${l}`)
        .join('\n'),
    );

    if (distanciasIdenticas < corretos.length) {
      console.log('\n   Qual variante da fórmula reproduz as distâncias da resposta?');
      for (const [nomeVariante, formula] of Object.entries(VARIANTES_DE_HAVERSINE)) {
        let iguais = 0;
        let comparadas = 0;
        for (const [esperado] of corretos) {
          const pa = esperado.posicoes?.[String(esperado.idA)];
          const pb = esperado.posicoes?.[String(esperado.idB)];
          if (!pa || !pb || esperado.distancia === null) continue;
          comparadas++;
          if (formula(pa.lat, pa.lon, pb.lat, pb.lon) === esperado.distancia) iguais++;
        }
        console.log(`     ${nomeVariante.padEnd(40)} ${numero(iguais)}/${numero(comparadas)}`);
      }
    }
  }
  return resultado;
}

function mostrarExemplos(
  titulo: string,
  itens: Item[],
  contexto: Contexto,
  outroLado: Map<string, Item>,
  lado: 'esperado' | 'nosso',
): void {
  if (itens.length === 0) return;
  const motivos = new Map<string, number>();
  const explicacoes = itens.map((i) => {
    const motivo = contexto.explicar(i, lado);
    const outro = outroLado.get(chaveDoPar(i));
    const resumo = `${motivo.replace(/ \(.*\)$/, '')}${outro ? ` [do outro lado: "${outro.tipo}"]` : ''}`;
    motivos.set(resumo, (motivos.get(resumo) ?? 0) + 1);
    return motivo;
  });
  console.log(`\n   ${titulo}: ${numero(itens.length)}`);
  for (const [motivo, quantidade] of [...motivos].sort((a, b) => b[1] - a[1])) console.log(`     • ${numero(quantidade)}× ${motivo}`);
  console.log('     Exemplos:');
  itens.slice(0, 8).forEach((i, k) => {
    const outro = outroLado.get(chaveDoPar(i));
    const nota = outro ? ` [do outro lado está como "${outro.tipo}"]` : '';
    console.log(`       ${i.tipo} ${i.idA}×${i.idB} @ ${i.timestamp}${i.distancia !== null ? ` (${i.distancia.toFixed(3)} m)` : ''} — ${explicacoes[k]}${nota}`);
  });
}

function ordenarPosicoes(posicoes: Item['posicoes']): [string, number, number][] {
  if (!posicoes) return [];
  return Object.entries(posicoes)
    .map(([id, p]): [string, number, number] => [String(Number(id)), Number(p?.lat), Number(p?.lon)])
    .sort((a, b) => Number(a[0]) - Number(b[0]));
}

function principal(): void {
  const pares = listarDatasets()
    .map((dataset) => ({ dataset, resposta: caminhoDaResposta(dataset) }))
    .filter((p): p is { dataset: string; resposta: string } => p.resposta !== null);
  if (pares.length === 0) {
    console.error('Nenhum par dataset/respostas encontrado em data/ (esperado: dataset1.txt + respostas1.json…). Rode "npm run baixar".');
    process.exitCode = 1;
    return;
  }
  console.log('Validação contra as respostas oficiais (Score = corretos − falsos positivos)');
  const resultados = pares.map((p) => validar(p.dataset, p.resposta));
  const score = resultados.reduce((s, r) => s + r.score, 0);
  const maximo = resultados.reduce((s, r) => s + r.scoreMaximo, 0);
  const perfeito = resultados.every((r) => r.score === r.scoreMaximo && r.naoEncontrados === 0);
  console.log(
    `\n${perfeito ? '✅ Validação perfeita' : '❌ Há divergências'}: score total ${numero(score)} de ${numero(maximo)} nos datasets com resposta.\n`,
  );
  mkdirSync(dirname(RELATORIO_VALIDACAO), { recursive: true });
  writeFileSync(RELATORIO_VALIDACAO, `${JSON.stringify(resultados, null, 2)}\n`);
  if (!perfeito) process.exitCode = 2;
}

principal();
