/**
 * Detector de encontros — o coração da solução.
 *
 * Ideia: comparar "todo mundo com todo mundo" em cada timestamp custa O(P²) por timestamp
 * (P = pessoas naquele instante). Mas dois pontos a menos de 20 m precisam ter latitudes quase
 * iguais (diferença < 0,00018°). Então, em cada timestamp:
 *
 *   1. ordenamos as posições por latitude — O(P log P);
 *   2. para cada posição, olhamos só as seguintes enquanto a latitude estiver dentro da janela
 *      de 20 m (quando sai da janela, todas as próximas também estão fora: paramos — "sweep");
 *   3. um filtro de longitude, igualmente barato, elimina quem está longe na outra direção;
 *   4. só os candidatos que sobram passam pela classificação e pelo Haversine (< 20 m).
 *
 * Resultado: o custo deixa de crescer com o quadrado do número de pessoas e passa a ser
 * praticamente proporcional ao número de posições.
 */
import {
  DISTANCIA_LIMITE_METROS,
  distanciaHaversine,
  janelaLatitudeGraus,
  janelaLongitudeGraus,
} from './geo.js';
import type { Dataset } from './leitura.js';
import { criarClassificador } from './regras.js';
import type { TipoEncontro } from './tipos.js';

export interface EncontroDetectado {
  tipo: TipoEncontro;
  /** Índice do timestamp em `dataset.timestamps`. */
  timestamp: number;
  /** Ids das duas pessoas (idA < idB) e o índice da posição de cada uma no dataset. */
  idA: number;
  idB: number;
  posicaoA: number;
  posicaoB: number;
  distanciaMetros: number;
}

export interface ResultadoDeteccao {
  /** Em ordem cronológica e, dentro do mesmo timestamp, pelos ids. */
  encontros: EncontroDetectado[];
  /** Linhas repetidas da mesma pessoa no mesmo timestamp (vale a primeira do arquivo). */
  posicoesDuplicadas: number;
  /** Quantos pares passaram pelo pré-filtro e tiveram o Haversine calculado. */
  distanciasCalculadas: number;
}

/** A ordenação usa "faixas" de latitude de 0,00001° (≈ 1,1 m). */
const FAIXAS_POR_GRAU = 100_000;
/** Soma 90° para a faixa nunca ser negativa. */
const DESLOCAMENTO_DAS_FAIXAS = 90 * FAIXAS_POR_GRAU;
/** A parte baixa da chave de ordenação guarda o índice local (até 2^24 posições por timestamp). */
const BASE_DO_INDICE = 2 ** 24;

export function detectarEncontros(ds: Dataset): ResultadoDeteccao {
  const { totalPosicoes, timestamps, pessoaDaPosicao, timestampDaPosicao, latitude, longitude, pessoas } = ds;
  const totalTimestamps = timestamps.length;
  const classificar = criarClassificador(ds);
  const janelaLatitude = janelaLatitudeGraus();
  const janelaLongitude = janelaLongitudeGraus(ds.maiorLatitudeAbsoluta);
  // Quantas faixas cabem na janela de latitude (+2 de folga para arredondamento).
  const faixasNaJanela = Math.floor(janelaLatitude * FAIXAS_POR_GRAU) + 2;

  // 1) Agrupa as posições por timestamp com counting sort: O(N) e estável (mantém a ordem do
  //    arquivo dentro de cada timestamp). O grupo do timestamp t é ordem[inicio[t] .. inicio[t+1]-1].
  const inicio = new Int32Array(totalTimestamps + 1);
  for (let i = 0; i < totalPosicoes; i++) inicio[timestampDaPosicao[i] + 1]++;
  let maiorGrupo = 0;
  for (let t = 0; t < totalTimestamps; t++) {
    if (inicio[t + 1] > maiorGrupo) maiorGrupo = inicio[t + 1];
    inicio[t + 1] += inicio[t];
  }
  const ordem = new Int32Array(totalPosicoes);
  const proximaVaga = inicio.slice(0, totalTimestamps);
  for (let i = 0; i < totalPosicoes; i++) ordem[proximaVaga[timestampDaPosicao[i]]++] = i;

  // 2) Percorre os timestamps em ordem cronológica (o texto YYYY-MM-DD HH:MM:SS ordena igual ao tempo).
  const cronologia = Array.from({ length: totalTimestamps }, (_, t) => t).sort((a, b) =>
    timestamps[a] < timestamps[b] ? -1 : timestamps[a] > timestamps[b] ? 1 : 0,
  );

  // Áreas de trabalho reaproveitadas em todos os timestamps (nada é alocado no laço).
  const ultimoTimestampDaPessoa = new Int32Array(pessoas.length).fill(-1);
  const grupo = new Int32Array(maiorGrupo);
  const chaves = new Float64Array(maiorGrupo);
  const ordenado = new Int32Array(maiorGrupo);
  const faixa = new Int32Array(maiorGrupo);
  const porIds = (x: EncontroDetectado, y: EncontroDetectado): number => x.idA - y.idA || x.idB - y.idB;

  const encontros: EncontroDetectado[] = [];
  const doTimestamp: EncontroDetectado[] = [];
  let posicoesDuplicadas = 0;
  let distanciasCalculadas = 0;

  for (const t of cronologia) {
    // 3) Monta o grupo do timestamp descartando posição repetida da mesma pessoa.
    let tamanho = 0;
    for (let k = inicio[t]; k < inicio[t + 1]; k++) {
      const posicao = ordem[k];
      const pessoa = pessoaDaPosicao[posicao];
      if (ultimoTimestampDaPessoa[pessoa] === t) {
        posicoesDuplicadas++;
        continue;
      }
      ultimoTimestampDaPessoa[pessoa] = t;
      grupo[tamanho++] = posicao;
    }
    if (tamanho < 2) continue;

    // 4) Ordena o grupo por faixa de latitude.
    ordenarPorLatitude(grupo, tamanho, latitude, chaves, ordenado, faixa);

    // 5) Varredura: para cada posição, só as seguintes dentro da janela de latitude.
    for (let x = 0; x < tamanho - 1; x++) {
      const i = ordenado[x];
      const latI = latitude[i];
      const lonI = longitude[i];
      const faixaMaxima = faixa[x] + faixasNaJanela;
      const pessoaI = pessoaDaPosicao[i];

      for (let y = x + 1; y < tamanho; y++) {
        if (faixa[y] > faixaMaxima) break; // daqui pra frente, todos estão a mais de 20 m

        const j = ordenado[y];
        const latJ = latitude[j];
        const diferencaLatitude = latI > latJ ? latI - latJ : latJ - latI;
        if (diferencaLatitude > janelaLatitude) continue;

        const lonJ = longitude[j];
        let diferencaLongitude = lonI > lonJ ? lonI - lonJ : lonJ - lonI;
        if (diferencaLongitude > 180) diferencaLongitude = 360 - diferencaLongitude; // antimeridiano
        if (diferencaLongitude > janelaLongitude) continue;

        const pessoaJ = pessoaDaPosicao[j];
        const tipo = classificar(pessoaI, pessoaJ);
        if (tipo === null) continue;

        distanciasCalculadas++;
        const distancia = distanciaHaversine(latI, lonI, latJ, lonJ);
        if (!(distancia < DISTANCIA_LIMITE_METROS)) continue;

        const idI = pessoas[pessoaI].id;
        const idJ = pessoas[pessoaJ].id;
        doTimestamp.push(
          idI < idJ
            ? { tipo, timestamp: t, idA: idI, idB: idJ, posicaoA: i, posicaoB: j, distanciaMetros: distancia }
            : { tipo, timestamp: t, idA: idJ, idB: idI, posicaoA: j, posicaoB: i, distanciaMetros: distancia },
        );
      }
    }

    if (doTimestamp.length > 0) {
      if (doTimestamp.length > 1) doTimestamp.sort(porIds);
      for (const encontro of doTimestamp) encontros.push(encontro);
      doTimestamp.length = 0;
    }
  }

  return { encontros, posicoesDuplicadas, distanciasCalculadas };
}

/**
 * Ordena as `tamanho` primeiras posições de `grupo` por faixa de latitude.
 * Saída: `ordenado[k]` = posição e `faixa[k]` = faixa dela, em ordem crescente.
 *
 * Truque de desempenho: sort() com função de comparação chama JavaScript a cada comparação.
 * Em vez disso, cada posição vira um único número — faixa × 2^24 + índice local — e o
 * Float64Array é ordenado pelo sort nativo (C++), cerca de 2,5× mais rápido. Os números
 * ficam abaixo de 2^53, então são inteiros exatos em double.
 */
function ordenarPorLatitude(
  grupo: Int32Array,
  tamanho: number,
  latitude: Float64Array,
  chaves: Float64Array,
  ordenado: Int32Array,
  faixa: Int32Array,
): void {
  if (tamanho >= BASE_DO_INDICE) {
    // Mais de 16,7 milhões de pessoas no mesmo instante: o índice não cabe na chave → sort comum.
    ordenado.set(grupo.subarray(0, tamanho));
    ordenado.subarray(0, tamanho).sort((a, b) => (latitude[a] < latitude[b] ? -1 : latitude[a] > latitude[b] ? 1 : 0));
    for (let k = 0; k < tamanho; k++) faixa[k] = Math.floor(latitude[ordenado[k]] * FAIXAS_POR_GRAU) + DESLOCAMENTO_DAS_FAIXAS;
    return;
  }
  for (let k = 0; k < tamanho; k++) {
    chaves[k] = (Math.floor(latitude[grupo[k]] * FAIXAS_POR_GRAU) + DESLOCAMENTO_DAS_FAIXAS) * BASE_DO_INDICE + k;
  }
  chaves.subarray(0, tamanho).sort();
  for (let k = 0; k < tamanho; k++) {
    const chave = chaves[k];
    const local = chave % BASE_DO_INDICE;
    faixa[k] = (chave - local) / BASE_DO_INDICE;
    ordenado[k] = grupo[local];
  }
}
