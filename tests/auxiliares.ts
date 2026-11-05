import { detectarEncontros } from '../src/detector.js';
import { interpretarDataset } from '../src/leitura.js';
import { paraSaida } from '../src/saida.js';
import type { EncontroSaida } from '../src/tipos.js';

export const CABECALHO = 'idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida';

/** Monta um arquivo no formato do enunciado a partir de linhas. */
export function arquivo(...linhas: string[]): string {
  return `${[CABECALHO, ...linhas].join('\n')}\n`;
}

/** Executa o pipeline completo (leitura → detecção → saída) sobre um texto. */
export function detectar(texto: string): EncontroSaida[] {
  const ds = interpretarDataset(texto);
  return paraSaida(ds, detectarEncontros(ds).encontros);
}

const METROS_POR_GRAU = (6_371_000 * Math.PI) / 180;

/** Latitude deslocada `metros` para o norte (mesma longitude). */
export function maisMetrosAoNorte(latitude: number, metros: number): number {
  return latitude + metros / METROS_POR_GRAU;
}
