/**
 * Gerador de datasets SINTÉTICOS no mesmo formato do enunciado.
 *
 * Usado pelos testes (cenários aleatórios comparados com a força bruta) e pelo benchmark de
 * escala. Gera pessoas andando em uma área, grupos que andam juntos (geram encontros genéricos e
 * de facção), vítimas sendo seguidas pelo agressor (geram encontros de medida protetiva) e,
 * opcionalmente, "sujeira" típica de dados reais: linhas duplicadas, inválidas, em branco,
 * vírgula decimal, aspas, \r\n, booleanos em formatos variados etc.
 *
 * Uso direto:  node dist/ferramentas/gerar-dataset.js <saida.txt> [pessoas] [timestamps] [--ruido]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface OpcoesGerador {
  semente?: number;
  pessoas?: number;
  timestamps?: number;
  /** Timestamp inicial (UTC), avança de 5 em 5 segundos. */
  inicio?: string;
  /** Lado (em metros) da área quadrada onde as pessoas circulam. */
  ladoAreaMetros?: number;
  fracaoVitimas?: number;
  faccoes?: number;
  fracaoSemFaccao?: number;
  /** Probabilidade de uma pessoa ter posição registrada em cada timestamp. */
  presenca?: number;
  ruido?: boolean;
}

const LATITUDE_BASE = -10.08;
const LONGITUDE_BASE = -37.08;
const METROS_POR_GRAU = (6_371_000 * Math.PI) / 180;

/** PRNG determinístico (mulberry32): mesma semente → mesmo dataset. */
export function criarAleatorio(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PessoaGerada {
  id: number;
  faccao: string;
  vitima: boolean;
  agressores: number[];
  /** Índice da pessoa seguida (grupo/perseguição) ou -1. */
  segue: number;
  deslocamentoX: number;
  deslocamentoY: number;
  x: number;
  y: number;
  formatoMedida: number;
  formatoIds: number;
}

export function gerarDataset(opcoes: OpcoesGerador = {}): string {
  const aleatorio = criarAleatorio(opcoes.semente ?? 42);
  const totalPessoas = opcoes.pessoas ?? 60;
  const totalTimestamps = opcoes.timestamps ?? 120;
  const lado = opcoes.ladoAreaMetros ?? 400;
  const fracaoVitimas = opcoes.fracaoVitimas ?? 0.2;
  const totalFaccoes = opcoes.faccoes ?? 4;
  const fracaoSemFaccao = opcoes.fracaoSemFaccao ?? 0.25;
  const presenca = opcoes.presenca ?? 0.97;
  const ruido = opcoes.ruido ?? false;
  const inicio = Date.parse(`${(opcoes.inicio ?? '2024-01-01 00:00:00').replace(' ', 'T')}Z`);

  const gaussiano = (): number => {
    const u = 1 - aleatorio();
    const v = aleatorio();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const escolher = <T>(itens: readonly T[]): T => itens[Math.floor(aleatorio() * itens.length)];

  // --- Pessoas ------------------------------------------------------------------------------
  const ids = embaralhar(
    Array.from({ length: totalPessoas }, (_, i) => i + 1),
    aleatorio,
  );
  const totalVitimas = Math.min(totalPessoas - 1, Math.round(totalPessoas * fracaoVitimas));
  const pessoas: PessoaGerada[] = ids.map((id, i) => ({
    id,
    faccao: '',
    vitima: i < totalVitimas,
    agressores: [],
    segue: -1,
    deslocamentoX: 0,
    deslocamentoY: 0,
    x: aleatorio() * lado,
    y: aleatorio() * lado,
    formatoMedida: Math.floor(aleatorio() * 4),
    formatoIds: Math.floor(aleatorio() * 3),
  }));
  const monitorados = pessoas.filter((p) => !p.vitima);
  const indiceDe = new Map(pessoas.map((p, i) => [p, i]));

  for (const p of monitorados) {
    if (aleatorio() >= fracaoSemFaccao && totalFaccoes > 0) p.faccao = String(1 + Math.floor(aleatorio() * totalFaccoes));
    else p.faccao = ruido ? escolher(['', '', 'null', 'NULL', ' ']) : '';
  }
  for (const v of pessoas.filter((p) => p.vitima)) {
    const quantidade = 1 + (aleatorio() < 0.3 ? 1 : 0);
    while (v.agressores.length < Math.min(quantidade, monitorados.length)) {
      const agressor = escolher(monitorados).id;
      if (!v.agressores.includes(agressor)) v.agressores.push(agressor);
    }
    // Metade das vítimas é "seguida" pelo primeiro agressor (gera encontros de medida protetiva).
    if (aleatorio() < 0.5) {
      const agressor = monitorados.find((m) => m.id === v.agressores[0]);
      if (agressor) definirSeguidor(v, indiceDe.get(agressor) ?? -1, 30);
    }
  }
  // Parte dos monitorados anda em grupo (de preferência com alguém da mesma facção).
  for (const p of monitorados) {
    if (aleatorio() < 0.3) {
      const mesmaFaccao = monitorados.filter((o) => o !== p && o.faccao !== '' && o.faccao === p.faccao);
      const alvo = mesmaFaccao.length > 0 && aleatorio() < 0.7 ? escolher(mesmaFaccao) : escolher(monitorados);
      if (alvo !== p && alvo.segue === -1) definirSeguidor(p, indiceDe.get(alvo) ?? -1, 26);
    }
  }

  function definirSeguidor(p: PessoaGerada, alvo: number, raio: number): void {
    p.segue = alvo;
    const angulo = aleatorio() * 2 * Math.PI;
    const distancia = aleatorio() * raio;
    p.deslocamentoX = Math.cos(angulo) * distancia;
    p.deslocamentoY = Math.sin(angulo) * distancia;
  }

  // --- Linhas -------------------------------------------------------------------------------
  const linhas: string[] = ['idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida'];
  const cosBase = Math.cos((LATITUDE_BASE * Math.PI) / 180);
  const usarVirgulaDecimal = (): boolean => ruido && aleatorio() < 0.03;
  const espacos = (texto: string): string => (ruido && aleatorio() < 0.02 ? ` ${texto} ` : texto);

  for (let t = 0; t < totalTimestamps; t++) {
    const timestamp = formatarTimestamp(inicio + t * 5000);
    // Movimento: passeio aleatório; seguidores acompanham o alvo com um deslocamento que varia devagar.
    for (const p of pessoas) {
      if (p.segue >= 0) continue;
      p.x = refletir(p.x + gaussiano() * 4, lado);
      p.y = refletir(p.y + gaussiano() * 4, lado);
    }
    for (const p of pessoas) {
      if (p.segue < 0) continue;
      const alvo = pessoas[p.segue];
      p.deslocamentoX += gaussiano() * 1.5;
      p.deslocamentoY += gaussiano() * 1.5;
      p.x = alvo.x + p.deslocamentoX;
      p.y = alvo.y + p.deslocamentoY;
    }

    const doInstante: string[] = [];
    for (const p of pessoas) {
      if (aleatorio() > presenca) continue;
      const lat = (LATITUDE_BASE + p.y / METROS_POR_GRAU).toFixed(5);
      const lon = (LONGITUDE_BASE + p.x / (METROS_POR_GRAU * cosBase)).toFixed(5);
      const campos = [
        espacos(String(p.id)),
        p.faccao,
        timestamp,
        usarVirgulaDecimal() ? lat.replace('.', ',') : lat,
        usarVirgulaDecimal() ? lon.replace('.', ',') : lon,
        formatarMedida(p.vitima, ruido ? p.formatoMedida : 0),
        formatarIds(p.agressores, ruido ? p.formatoIds : 0),
      ];
      doInstante.push(campos.join(';'));

      if (ruido) {
        const sorteio = aleatorio();
        if (sorteio < 0.008) {
          doInstante.push(campos.join(';')); // duplicata exata
        } else if (sorteio < 0.015) {
          const outra = [...campos];
          outra[3] = (Number(lat) + (aleatorio() - 0.5) * 0.0004).toFixed(5);
          doInstante.push(outra.join(';')); // duplicata conflitante
        } else if (sorteio < 0.022) {
          doInstante.push(linhaInvalida(campos, aleatorio));
        } else if (sorteio < 0.025) {
          doInstante.push('');
        }
      }
    }
    if (ruido && aleatorio() < 0.5) embaralhar(doInstante, aleatorio);
    for (const linha of doInstante) linhas.push(linha);
  }

  if (ruido) {
    // Parte do arquivo fora de ordem e quebras de linha do Windows.
    const corpo = linhas.slice(1);
    const trecho = Math.floor(corpo.length * 0.1);
    const fora = corpo.splice(Math.floor(aleatorio() * (corpo.length - trecho)), trecho);
    corpo.push(...fora);
    const quebra = aleatorio() < 0.5 ? '\r\n' : '\n';
    return `${[linhas[0], ...corpo].join(quebra)}${quebra}`;
  }
  return `${linhas.join('\n')}\n`;
}

function linhaInvalida(campos: string[], aleatorio: () => number): string {
  const ruim = [...campos];
  switch (Math.floor(aleatorio() * 6)) {
    case 0:
      ruim[0] = `X${ruim[0]}`;
      break;
    case 1:
      ruim[2] = '';
      break;
    case 2:
      ruim[3] = '';
      break;
    case 3:
      ruim[4] = 'abc';
      break;
    case 4:
      ruim[3] = '0';
      ruim[4] = '0';
      break;
    default:
      ruim[3] = '95.00000';
  }
  return ruim.join(';');
}

function formatarMedida(vitima: boolean, formato: number): string {
  const formatos = [
    ['false', 'true'],
    ['0', '1'],
    ['N', 'S'],
    ['False', 'True'],
  ];
  return formatos[formato][vitima ? 1 : 0];
}

function formatarIds(ids: number[], formato: number): string {
  if (ids.length === 0) return '';
  if (formato === 1) return `"${ids.join(',')}"`;
  if (formato === 2) return `[${ids.join(', ')}]`;
  return ids.join(',');
}

function formatarTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function refletir(valor: number, lado: number): number {
  if (valor < 0) return -valor;
  if (valor > lado) return 2 * lado - valor;
  return valor;
}

function embaralhar<T>(itens: T[], aleatorio: () => number): T[] {
  for (let i = itens.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [itens[i], itens[j]] = [itens[j], itens[i]];
  }
  return itens;
}

// Execução direta pela linha de comando (comparação sem diferenciar maiúsculas, por causa do Windows).
const executadoDireto =
  process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (executadoDireto) {
  const [saida, pessoas, timestamps] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!saida) {
    console.log('Uso: node dist/ferramentas/gerar-dataset.js <saida.txt> [pessoas] [timestamps] [--ruido]');
    process.exit(1);
  }
  const texto = gerarDataset({
    pessoas: pessoas ? Number(pessoas) : 200,
    timestamps: timestamps ? Number(timestamps) : 720,
    ladoAreaMetros: 3000,
    ruido: process.argv.includes('--ruido'),
  });
  writeFileSync(saida, texto);
  console.log(`Dataset sintético gravado em ${saida} (${(texto.length / 1e6).toFixed(1)} MB)`);
}
