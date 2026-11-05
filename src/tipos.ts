/**
 * Tipos compartilhados entre os módulos.
 */

/** Valores aceitos no campo "tipo" do JSON de saída (conforme o enunciado). */
export type TipoEncontro = 'generico' | 'faccao' | 'protetiva';

/** Posição de uma pessoa dentro de um encontro. */
export interface PosicaoSaida {
  lat: number;
  lon: number;
}

/** Um item do array de saída — mesma estrutura do exemplo do enunciado. */
export interface EncontroSaida {
  tipo: TipoEncontro;
  monitoradosEncontro: [number, number];
  timestamp: string;
  posicoes: Record<string, PosicaoSaida>;
  distanciaMetros: number;
}
