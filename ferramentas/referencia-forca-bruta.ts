/**
 * Implementação de REFERÊNCIA por força bruta — propositalmente simples e independente da versão
 * otimizada (não reaproveita a leitura, o detector nem as regras de src/).
 *
 * Lê o arquivo com split(), compara TODOS os pares de cada timestamp e aplica as regras do
 * enunciado. É lenta — O(P²) por timestamp —, mas fácil de conferir a olho. Serve para provar
 * que as otimizações (leitura byte a byte, ordenação + janela, pré-filtros) não mudam o resultado:
 * os testes e o `npm run tudo` exigem que as duas versões gerem exatamente o mesmo JSON.
 *
 * A única coisa compartilhada é a fórmula de Haversine, que é fixada pelo enunciado.
 */
import { distanciaHaversine } from '../src/geo.js';
import type { EncontroSaida, TipoEncontro } from '../src/tipos.js';

interface Linha {
  pessoa: PessoaReferencia;
  timestamp: string;
  lat: number;
  lon: number;
}

interface PessoaReferencia {
  id: number;
  faccao: string | null;
  vitima: boolean;
  restricoes: number[];
}

const COLUNAS = ['idmonitorado', 'faccaomonitorado', 'timestamp', 'latitude', 'longitude', 'medidaprotetiva', 'idsrestricaomedida'];
const SINONIMOS: Record<string, string> = { id: 'idmonitorado', faccao: 'faccaomonitorado', datahora: 'timestamp', lat: 'latitude', lon: 'longitude', lng: 'longitude' };
const SEM_FACCAO = ['', '-', 'NULL', 'NONE', 'UNDEFINED', 'NAN', 'N/A', 'NA', 'NIL'];

const limpar = (campo: string | undefined): string => (campo ?? '').replace(/^[ \t\r"]+|[ \t\r"]+$/g, '');
const emBranco = (linha: string): boolean => /^[ \t\r]*$/.test(linha);

function inteiro(campo: string | undefined): number {
  const texto = limpar(campo);
  const m = /^([+-]?)(\d{1,15})(?:[.,]0*)?$/.exec(texto);
  return m ? Number(m[1] + m[2]) : NaN;
}

function decimal(campo: string | undefined): number {
  const texto = limpar(campo);
  return texto === '' ? NaN : Number(texto.replace(',', '.'));
}

function listaDeIds(campo: string | undefined): number[] {
  const ids: number[] = [];
  for (const token of (campo ?? '').match(/\d+(?:\.\d*)?/g) ?? []) {
    const [parteInteira, parteDecimal = ''] = token.split('.');
    if (/[1-9]/.test(parteDecimal) || parteInteira.length > 15) continue;
    ids.push(Number(parteInteira));
  }
  return ids;
}

export function detectarPorForcaBruta(texto: string): EncontroSaida[] {
  const linhasDoArquivo = texto.replace(/^﻿/, '').split('\n');

  // Cabeçalho e ordem das colunas.
  let indice = 0;
  while (indice < linhasDoArquivo.length && emBranco(linhasDoArquivo[indice])) indice++;
  let coluna = COLUNAS.map((_, i) => i);
  if (indice < linhasDoArquivo.length && Number.isNaN(inteiro(linhasDoArquivo[indice].split(';')[0]))) {
    const nomes = linhasDoArquivo[indice].split(';').map((n) => {
      const limpo = limpar(n).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
      return SINONIMOS[limpo] ?? limpo;
    });
    const mapa = COLUNAS.map((c) => nomes.indexOf(c));
    if ([0, 2, 3, 4].every((papel) => mapa[papel] >= 0)) coluna = mapa.map((c) => (c < 0 ? 999 : c));
    indice++;
  }

  // Leitura das linhas.
  const pessoas = new Map<number, PessoaReferencia>();
  const linhas: Linha[] = [];
  for (; indice < linhasDoArquivo.length; indice++) {
    const linha = linhasDoArquivo[indice];
    const campos = linha.split(';');
    if (campos.length === 1 && emBranco(linha)) continue;

    const id = inteiro(campos[coluna[0]]);
    if (Number.isNaN(id)) continue;
    let pessoa = pessoas.get(id);
    if (!pessoa) {
      const restricoes = listaDeIds(campos[coluna[6]]);
      const faccao = limpar(campos[coluna[1]]).trim().toUpperCase();
      pessoa = {
        id,
        faccao: SEM_FACCAO.includes(faccao) ? null : faccao,
        vitima: /^[tTsSyYvV1]/.test(limpar(campos[coluna[5]])) || restricoes.length > 0,
        restricoes,
      };
      pessoas.set(id, pessoa);
    }

    const timestamp = limpar(campos[coluna[2]]);
    if (timestamp === '') continue;
    const lat = decimal(campos[coluna[3]]);
    const lon = decimal(campos[coluna[4]]);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) || (lat === 0 && lon === 0)) continue;
    linhas.push({ pessoa, timestamp, lat, lon });
  }

  // Agrupa por timestamp, mantendo a primeira posição de cada pessoa.
  const porTimestamp = new Map<string, Map<number, Linha>>();
  for (const linha of linhas) {
    let grupo = porTimestamp.get(linha.timestamp);
    if (!grupo) porTimestamp.set(linha.timestamp, (grupo = new Map()));
    if (!grupo.has(linha.pessoa.id)) grupo.set(linha.pessoa.id, linha);
  }

  const encontros: EncontroSaida[] = [];
  for (const [timestamp, grupo] of porTimestamp) {
    const posicoes = [...grupo.values()];
    for (let i = 0; i < posicoes.length; i++) {
      for (let j = i + 1; j < posicoes.length; j++) {
        const [a, b] = posicoes[i].pessoa.id < posicoes[j].pessoa.id ? [posicoes[i], posicoes[j]] : [posicoes[j], posicoes[i]];
        const tipo = tipoDoEncontro(a.pessoa, b.pessoa);
        if (tipo === null) continue;
        const distancia = distanciaHaversine(a.lat, a.lon, b.lat, b.lon);
        if (distancia >= 20) continue;
        encontros.push({
          tipo,
          monitoradosEncontro: [a.pessoa.id, b.pessoa.id],
          timestamp,
          posicoes: { [a.pessoa.id]: { lat: a.lat, lon: a.lon }, [b.pessoa.id]: { lat: b.lat, lon: b.lon } },
          distanciaMetros: distancia,
        });
      }
    }
  }

  return encontros.sort(
    (x, y) =>
      (x.timestamp < y.timestamp ? -1 : x.timestamp > y.timestamp ? 1 : 0) ||
      x.monitoradosEncontro[0] - y.monitoradosEncontro[0] ||
      x.monitoradosEncontro[1] - y.monitoradosEncontro[1],
  );
}

function tipoDoEncontro(a: PessoaReferencia, b: PessoaReferencia): TipoEncontro | null {
  if (a.restricoes.includes(b.id) || b.restricoes.includes(a.id)) return 'protetiva';
  if (a.vitima || b.vitima) return null;
  if (a.faccao !== null && a.faccao === b.faccao) return 'faccao';
  return 'generico';
}
