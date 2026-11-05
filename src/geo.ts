/**
 * Geometria: distância de Haversine e as "janelas" usadas como pré-filtro barato.
 */

/** Raio da Terra exigido pelo enunciado. */
export const RAIO_TERRA_METROS = 6_371_000;

/** Há encontro quando a distância é MENOR que este valor (enunciado: "distância menor que 20 metros"). */
export const DISTANCIA_LIMITE_METROS = 20;

/**
 * Margem relativa minúscula aplicada às janelas do pré-filtro, só para absorver arredondamento
 * de ponto flutuante. Ela deixa passar alguns candidatos a mais (que o Haversine descarta),
 * mas nunca descarta um encontro verdadeiro.
 */
const MARGEM_DE_SEGURANCA = 1 + 1e-9;

function paraRadianos(graus: number): number {
  return (graus * Math.PI) / 180;
}

/**
 * Distância em metros entre dois pontos (em graus decimais) pela Fórmula de Haversine.
 *
 * Está escrita na forma clássica (diferenças calculadas em graus e depois convertidas para
 * radianos). Com o exemplo do enunciado — monitorados 40 e 44 — ela reproduz exatamente o valor
 * 11.406788673336607 publicado na resposta, bit a bit.
 */
export function distanciaHaversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = paraRadianos(lat2 - lat1);
  const dLon = paraRadianos(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(paraRadianos(lat1)) * Math.cos(paraRadianos(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return RAIO_TERRA_METROS * c;
}

/**
 * Maior diferença de LATITUDE (em graus) que dois pontos a menos de `distancia` metros podem ter.
 *
 * Por quê: a distância entre dois pontos nunca é menor que R·|Δlatitude| — andar pelo meridiano
 * é o caminho mais curto para mudar de latitude. Para 20 m isso dá ≈ 0,00018° (5ª casa decimal).
 */
export function janelaLatitudeGraus(distancia: number = DISTANCIA_LIMITE_METROS): number {
  return ((distancia / RAIO_TERRA_METROS) * (180 / Math.PI)) * MARGEM_DE_SEGURANCA;
}

/**
 * Maior diferença de LONGITUDE (em graus) que dois pontos a menos de `distancia` metros podem ter,
 * sabendo que nenhum dos dois está além da latitude ±`maiorLatitudeAbsoluta`.
 *
 * Por quê: na fórmula, sin²(d/2R) ≥ cos(lat1)·cos(lat2)·sin²(Δlon/2) ≥ cos²(latMáx)·sin²(Δlon/2).
 * Perto dos polos o grau de longitude "encolhe" e o filtro deixa de ajudar (devolve 180°).
 */
export function janelaLongitudeGraus(
  maiorLatitudeAbsoluta: number,
  distancia: number = DISTANCIA_LIMITE_METROS,
): number {
  const latitudeLimite = Math.min(90, Math.abs(maiorLatitudeAbsoluta));
  const cossenoMinimo = Math.cos(paraRadianos(latitudeLimite));
  const razao = Math.sin(distancia / (2 * RAIO_TERRA_METROS)) / cossenoMinimo;
  if (!(razao < 1)) return 180;
  return Math.min(180, ((2 * Math.asin(razao) * 180) / Math.PI) * MARGEM_DE_SEGURANCA);
}
