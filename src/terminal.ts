/**
 * Pequenos utilitários de formatação para o terminal (tabelas e números em pt-BR).
 */

export interface Coluna {
  titulo: string;
  direita?: boolean;
}

export function tabela(colunas: readonly Coluna[], linhas: readonly (readonly string[])[]): string {
  const larguras = colunas.map((c, i) => Math.max(c.titulo.length, ...linhas.map((l) => (l[i] ?? '').length)));
  const formatar = (valores: readonly string[]): string =>
    colunas
      .map((c, i) => (c.direita ? (valores[i] ?? '').padStart(larguras[i]) : (valores[i] ?? '').padEnd(larguras[i])))
      .join('  ')
      .trimEnd();
  return [
    formatar(colunas.map((c) => c.titulo)),
    larguras.map((l) => '─'.repeat(l)).join('  '),
    ...linhas.map(formatar),
  ].join('\n');
}

export function numero(valor: number): string {
  return valor.toLocaleString('pt-BR');
}

export function milissegundos(valor: number): string {
  const casas = valor < 10 ? 2 : 1;
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })} ms`;
}

/** Ordena "dataset2" antes de "dataset10". */
export function ordemNatural(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR', { numeric: true });
}
