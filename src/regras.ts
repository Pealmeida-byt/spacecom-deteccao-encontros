/**
 * Regras de negócio: qual é o tipo do encontro entre duas pessoas próximas?
 *
 * Pela regra de unicidade, cada par gera no máximo UM registro por timestamp. Quando um par se
 * encaixa em mais de um tipo, vale a prioridade do mais específico para o mais geral:
 *
 *   1. protetiva → uma pessoa está na lista de restrição (idsRestricaoMedida) da outra
 *   2. faccao    → dois monitorados de tornozeleira da MESMA facção
 *   3. generico  → dois monitorados de tornozeleira quaisquer
 *
 * Vítima perto de alguém que não é o seu agressor (ou de outra vítima) não gera encontro:
 * encontros genéricos e de facção são entre monitorados (tornozeleira); a vítima só entra no
 * encontro de medida protetiva.
 *
 * Toda a regra está concentrada aqui: se a interpretação precisar mudar, muda num lugar só.
 */
import type { Dataset } from './leitura.js';
import type { TipoEncontro } from './tipos.js';

/** Recebe os índices de duas pessoas e devolve o tipo do encontro (ou null se não houver). */
export type Classificador = (pessoaA: number, pessoaB: number) => TipoEncontro | null;

export function criarClassificador(ds: Dataset): Classificador {
  const totalPessoas = ds.pessoas.length;
  // Chave numérica única para o par, independente da ordem (a,b) ou (b,a).
  const chaveDoPar = (a: number, b: number): number =>
    a < b ? a * totalPessoas + b : b * totalPessoas + a;

  // Pares (vítima, agressor) montados uma única vez → consulta O(1) durante a detecção.
  const paresComMedida = new Set<number>();
  ds.pessoas.forEach((pessoa, indice) => {
    for (const idAgressor of pessoa.restricoes) {
      const agressor = ds.indicePorId.get(idAgressor);
      if (agressor !== undefined && agressor !== indice) paresComMedida.add(chaveDoPar(indice, agressor));
    }
  });

  const { faccaoDaPessoa, ehVitima } = ds;

  return (a, b) => {
    if (paresComMedida.has(chaveDoPar(a, b))) return 'protetiva';
    if (ehVitima[a] === 1 || ehVitima[b] === 1) return null;
    const faccao = faccaoDaPessoa[a];
    return faccao !== -1 && faccao === faccaoDaPessoa[b] ? 'faccao' : 'generico';
  };
}
