/**
 * Geração do JSON de saída, na estrutura exata do enunciado:
 *
 *   {
 *     "tipo": "faccao",
 *     "monitoradosEncontro": [40, 44],
 *     "timestamp": "2024-01-01 00:01:50",
 *     "posicoes": { "40": { "lat": -10.07996, "lon": -37.08384 }, "44": { ... } },
 *     "distanciaMetros": 11.406788673336607
 *   }
 *
 * O arquivo é um array JSON com um encontro por linha — fácil de ler e de comparar com diff.
 */
import { closeSync, openSync, writeSync } from 'node:fs';
import type { EncontroDetectado } from './detector.js';
import type { Dataset } from './leitura.js';
import type { EncontroSaida } from './tipos.js';

/** Quantos encontros são montados na memória antes de cada escrita no disco. */
const ENCONTROS_POR_BLOCO = 4096;

/** Converte os encontros detectados em objetos no formato do enunciado. */
export function paraSaida(ds: Dataset, encontros: readonly EncontroDetectado[]): EncontroSaida[] {
  return encontros.map((e) => ({
    tipo: e.tipo,
    monitoradosEncontro: [e.idA, e.idB],
    timestamp: ds.timestamps[e.timestamp],
    posicoes: {
      [e.idA]: { lat: ds.latitude[e.posicaoA], lon: ds.longitude[e.posicaoA] },
      [e.idB]: { lat: ds.latitude[e.posicaoB], lon: ds.longitude[e.posicaoB] },
    },
    distanciaMetros: e.distanciaMetros,
  }));
}

/**
 * Grava o arquivo de saída em blocos, direto no disco: a memória usada não cresce com o tamanho
 * do resultado e fica ~2,5× mais rápido do que montar um texto gigante e gravar de uma vez.
 */
export function gravarEncontros(caminho: string, ds: Dataset, encontros: readonly EncontroDetectado[]): void {
  const arquivo = openSync(caminho, 'w');
  try {
    if (encontros.length === 0) {
      writeSync(arquivo, '[]\n');
      return;
    }
    const formatar = criarFormatador(ds);
    let bloco: string[] = [];
    writeSync(arquivo, '[\n');
    for (let k = 0; k < encontros.length; k++) {
      bloco.push(formatar(encontros[k]));
      if (bloco.length === ENCONTROS_POR_BLOCO && k < encontros.length - 1) {
        writeSync(arquivo, `${bloco.join(',\n')},\n`);
        bloco = [];
      }
    }
    writeSync(arquivo, `${bloco.join(',\n')}\n]\n`);
  } finally {
    closeSync(arquivo);
  }
}

/** O mesmo conteúdo de `gravarEncontros`, como texto (usado nos testes). */
export function serializarEncontros(ds: Dataset, encontros: readonly EncontroDetectado[]): string {
  if (encontros.length === 0) return '[]\n';
  return `[\n${encontros.map(criarFormatador(ds)).join(',\n')}\n]\n`;
}

/**
 * Monta o texto JSON de um encontro direto, sem criar objetos intermediários. O resultado é
 * idêntico ao JSON.stringify de `paraSaida` (garantido em tests/saida.test.ts).
 */
function criarFormatador(ds: Dataset): (e: EncontroDetectado) => string {
  const { latitude, longitude, timestamps } = ds;
  const timestampEmJson = new Map<number, string>();
  return (e) => {
    let timestamp = timestampEmJson.get(e.timestamp);
    if (timestamp === undefined) {
      timestamp = JSON.stringify(timestamps[e.timestamp]);
      timestampEmJson.set(e.timestamp, timestamp);
    }
    return (
      `{"tipo":"${e.tipo}","monitoradosEncontro":[${e.idA},${e.idB}],"timestamp":${timestamp},` +
      `"posicoes":{"${e.idA}":{"lat":${latitude[e.posicaoA]},"lon":${longitude[e.posicaoA]}},` +
      `"${e.idB}":{"lat":${latitude[e.posicaoB]},"lon":${longitude[e.posicaoB]}}},` +
      `"distanciaMetros":${e.distanciaMetros}}`
    );
  };
}
