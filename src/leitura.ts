/**
 * Leitura do dataset (.txt no estilo CSV, separado por ";").
 *
 * Por que não usar split() ou uma biblioteca de CSV?
 *   Um dataset de posições a cada 5 segundos cresce rápido (milhões de linhas). Com split(), cada
 *   linha vira várias strings — uma por campo — e isso custa memória e tempo de garbage collector.
 *   Aqui o arquivo é lido como bytes e cada campo é interpretado direto do buffer: números são
 *   montados dígito a dígito, sem criar strings. As posições vão para arrays tipados
 *   (Int32Array/Float64Array), contíguos na memória.
 *
 * Dois caminhos, mesmo resultado:
 *   - caminho rápido: a imensa maioria das linhas é "limpa" (sem espaços, aspas ou vírgula
 *     decimal) e de uma pessoa que já apareceu antes. Para elas os campos são lidos numa única
 *     passada, sem reler os atributos da pessoa;
 *   - caminho completo: qualquer linha fora desse formato estrito (primeira linha de cada pessoa,
 *     campos com espaços/aspas, vírgula decimal, linha inválida…) é interpretada com tolerância.
 *   O caminho rápido só aceita um subconjunto estrito do formato, então os dois dão exatamente o
 *   mesmo resultado — tests/leitura.test.ts compara os dois em datasets limpos e "sujos".
 *
 * Tolerância a dados "sujos" (sem quebrar a leitura):
 *   - BOM no início, quebras de linha \n ou \r\n, linhas em branco;
 *   - espaços e aspas em volta dos campos; vírgula como separador decimal ("-10,07996");
 *   - booleano em vários formatos: true/false, 1/0, sim/não, S/N, yes/no, verdadeiro/falso;
 *   - lista de ids como "1,2,3", "[1, 2, 3]" ou "1.0,2.0";
 *   - facção vazia ou escrita como null/none/NaN = sem facção;
 *   - colunas em outra ordem (mapeadas pelo nome no cabeçalho);
 *   - linhas inválidas (id não numérico, timestamp vazio, coordenada inválida ou 0,0) são
 *     descartadas e contadas nas estatísticas.
 */
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------------------------
// Estruturas de saída da leitura
// ---------------------------------------------------------------------------------------------

export interface Pessoa {
  id: number;
  /** Facção normalizada (maiúsculas, sem espaços nas bordas). null = sem facção. */
  faccao: string | null;
  /** É vítima com medida protetiva (usa rastreador portátil, não tornozeleira). */
  vitima: boolean;
  /** idsRestricaoMedida: ids dos agressores dos quais esta pessoa é protegida. */
  restricoes: number[];
}

export interface EstatisticasLeitura {
  /** Cabeçalho encontrado na primeira linha (null se o arquivo começa direto nos dados). */
  cabecalho: string | null;
  /** Linhas com conteúdo, sem contar o cabeçalho. */
  linhasDeDados: number;
  posicoesValidas: number;
  descartadas: {
    idInvalido: number;
    timestampInvalido: number;
    coordenadaInvalida: number;
  };
}

/**
 * Dataset já interpretado.
 *
 * As posições ficam em "struct of arrays": a posição `i` é a pessoa `pessoaDaPosicao[i]`
 * no timestamp `timestampDaPosicao[i]`, em (`latitude[i]`, `longitude[i]`).
 */
export interface Dataset {
  pessoas: Pessoa[];
  indicePorId: Map<number, number>;
  /** Por pessoa (mesmo índice de `pessoas`): código da facção (-1 = nenhuma). */
  faccaoDaPessoa: Int32Array;
  /** Por pessoa: 1 se for vítima, 0 se for monitorado de tornozeleira. */
  ehVitima: Uint8Array;

  totalPosicoes: number;
  pessoaDaPosicao: Int32Array;
  timestampDaPosicao: Int32Array;
  latitude: Float64Array;
  longitude: Float64Array;

  /** Texto original de cada timestamp distinto; o índice é o usado em `timestampDaPosicao`. */
  timestamps: string[];
  /** Maior |latitude| entre as posições válidas (usado no pré-filtro de longitude). */
  maiorLatitudeAbsoluta: number;
  estatisticas: EstatisticasLeitura;
}

export interface OpcoesLeitura {
  /** Usa o caminho rápido nas linhas limpas (padrão: true). Desligar serve só para os testes. */
  caminhoRapido?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------

const LF = 0x0a; // \n
const CR = 0x0d; // \r
const TAB = 0x09;
const ESPACO = 0x20;
const ASPAS = 0x22; // "
const PONTO_E_VIRGULA = 0x3b; // ;
const VIRGULA = 0x2c;
const PONTO = 0x2e;
const MENOS = 0x2d;
const MAIS = 0x2b;
const DOIS_PONTOS = 0x3a;
const ZERO = 0x30;

/** Ordem das colunas descrita no enunciado (usada quando não há cabeçalho reconhecível). */
export const COLUNAS_DO_ENUNCIADO = [
  'idMonitorado',
  'faccaoMonitorado',
  'timestamp',
  'latitude',
  'longitude',
  'medidaProtetiva',
  'idsRestricaoMedida',
] as const;

// Papel de cada coluna = índice em COLUNAS_DO_ENUNCIADO.
const ID = 0;
const FACCAO = 1;
const TIMESTAMP = 2;
const LATITUDE = 3;
const LONGITUDE = 4;
const MEDIDA = 5;
const IDS = 6;

const MAX_CAMPOS = 32;
/** Índice de coluna que nunca existe numa linha: o campo é lido como vazio. */
const COLUNA_AUSENTE = MAX_CAMPOS;
/** "YYYY-MM-DD HH:MM:SS" tem 19 caracteres. */
const TAMANHO_DO_TIMESTAMP = 19;

/** Nomes aceitos no cabeçalho (comparados sem acento, sem símbolos e em minúsculas). */
const NOMES_DE_COLUNA = new Map<string, number>([
  ['idmonitorado', ID],
  ['id', ID],
  ['faccaomonitorado', FACCAO],
  ['faccao', FACCAO],
  ['timestamp', TIMESTAMP],
  ['datahora', TIMESTAMP],
  ['latitude', LATITUDE],
  ['lat', LATITUDE],
  ['longitude', LONGITUDE],
  ['lon', LONGITUDE],
  ['lng', LONGITUDE],
  ['medidaprotetiva', MEDIDA],
  ['idsrestricaomedida', IDS],
]);

/** Textos que significam "sem facção". */
const VALORES_SEM_FACCAO = new Set(['', '-', 'NULL', 'NONE', 'UNDEFINED', 'NAN', 'N/A', 'NA', 'NIL']);

/** Potências de 10 exatas (10^0 … 10^22 são representáveis sem erro em double). */
const POTENCIA_DE_10 = Array.from({ length: 23 }, (_, i) => Number(`1e${i}`));

/** Posições dos dígitos em "YYYY-MM-DD HH:MM:SS". */
const DIGITOS_DO_TIMESTAMP = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18];

// ---------------------------------------------------------------------------------------------
// Registros de pessoas e timestamps (compartilhados pelos dois caminhos)
// ---------------------------------------------------------------------------------------------

/** id → índice da pessoa. Lembra a última consulta: em arquivos agrupados por pessoa, quase sempre acerta. */
class RegistroDePessoas {
  readonly lista: Pessoa[] = [];
  readonly indicePorId = new Map<number, number>();
  private ultimoId = NaN;
  private ultimoIndice = -1;

  /** Índice da pessoa com este id, ou -1 se ela ainda não apareceu. */
  buscar(id: number): number {
    if (id === this.ultimoId) return this.ultimoIndice;
    const indice = this.indicePorId.get(id);
    if (indice === undefined) return -1;
    this.ultimoId = id;
    this.ultimoIndice = indice;
    return indice;
  }

  registrar(pessoa: Pessoa): number {
    const indice = this.lista.length;
    this.lista.push(pessoa);
    this.indicePorId.set(pessoa.id, indice);
    this.ultimoId = pessoa.id;
    this.ultimoIndice = indice;
    return indice;
  }
}

/** Timestamp → índice. Em arquivos agrupados por tempo, a linha quase sempre repete o anterior. */
class RegistroDeTimestamps {
  readonly textos: string[] = [];
  private readonly porChave = new Map<number, number>();
  private readonly porTexto = new Map<string, number>();
  private ultimaChave = NaN;
  private ultimoIndice = -1;

  /** Timestamp no formato padrão, já convertido em chave numérica; o texto está em buf[inicio, fim). */
  doFormatoPadrao(chave: number, buf: Buffer, inicio: number, fim: number): number {
    if (chave === this.ultimaChave) return this.ultimoIndice;
    let indice = this.porChave.get(chave);
    if (indice === undefined) {
      indice = this.textos.length;
      this.textos.push(buf.toString('latin1', inicio, fim));
      this.porChave.set(chave, indice);
    }
    this.ultimaChave = chave;
    this.ultimoIndice = indice;
    return indice;
  }

  /** Timestamp fora do padrão: vale o texto exato (regra do "exato mesmo timestamp"). */
  doTexto(texto: string): number {
    let indice = this.porTexto.get(texto);
    if (indice === undefined) {
      indice = this.textos.length;
      this.textos.push(texto);
      this.porTexto.set(texto, indice);
    }
    return indice;
  }
}

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------

export function lerDataset(caminho: string, opcoes: OpcoesLeitura = {}): Dataset {
  return interpretarDataset(readFileSync(caminho), opcoes);
}

export function interpretarDataset(conteudo: Uint8Array | string, opcoes: OpcoesLeitura = {}): Dataset {
  const buf = paraBuffer(conteudo);
  const tamanho = buf.length;

  // Uma posição por linha, no máximo: dá para alocar os arrays uma única vez.
  const capacidade = contarLinhas(buf);
  const pessoaDaPosicao = new Int32Array(capacidade);
  const timestampDaPosicao = new Int32Array(capacidade);
  const latitude = new Float64Array(capacidade);
  const longitude = new Float64Array(capacidade);
  let total = 0;
  let maiorLatitudeAbsoluta = 0;

  const pessoas = new RegistroDePessoas();
  const timestamps = new RegistroDeTimestamps();
  const estatisticas: EstatisticasLeitura = {
    cabecalho: null,
    linhasDeDados: 0,
    posicoesValidas: 0,
    descartadas: { idInvalido: 0, timestampInvalido: 0, coordenadaInvalida: 0 },
  };

  const inicioCampo = new Int32Array(MAX_CAMPOS + 1);
  const fimCampo = new Int32Array(MAX_CAMPOS + 1);

  let pos = temBom(buf) ? 3 : 0;

  // 1) Cabeçalho: primeira linha não vazia cujo primeiro campo não é um número.
  let colunas: number[] = [ID, FACCAO, TIMESTAMP, LATITUDE, LONGITUDE, MEDIDA, IDS];
  while (pos < tamanho) {
    const campos = localizarCampos(buf, pos, tamanho, inicioCampo, fimCampo);
    const fimLinha = fimCampo[campos - 1];
    if (linhaEmBranco(buf, pos, fimLinha)) {
      pos = fimLinha + 1;
      continue;
    }
    if (Number.isNaN(lerInteiro(buf, inicioCampo[0], fimCampo[0]))) {
      estatisticas.cabecalho = lerTexto(buf, pos, fimLinha);
      colunas = mapearColunas(buf, inicioCampo, fimCampo, campos) ?? colunas;
      pos = fimLinha + 1;
    }
    break;
  }
  const [cId, cFaccao, cTimestamp, cLatitude, cLongitude, cMedida, cIds] = colunas;
  const usarCaminhoRapido = (opcoes.caminhoRapido ?? true) && colunas.every((coluna, papel) => coluna === papel);

  // 2) Linhas de dados.
  while (pos < tamanho) {
    let pessoa = -1;
    let timestamp = -1;

    // ---- Caminho rápido: "id;facção;YYYY-MM-DD HH:MM:SS;-10.07996;-37.08384;…" de pessoa conhecida.
    if (usarCaminhoRapido) {
      let i = pos;
      let id = 0;
      let digitos = 0;
      let b = buf[i];
      while (b >= ZERO && b <= ZERO + 9 && digitos <= 15) {
        id = id * 10 + (b - ZERO);
        digitos++;
        b = buf[++i];
      }
      if (b === PONTO_E_VIRGULA && digitos > 0 && digitos <= 15) {
        const conhecida = pessoas.buscar(id);
        if (conhecida >= 0) {
          // Facção: só pula — os atributos da pessoa já foram lidos na primeira linha dela.
          for (i++; i < tamanho; i++) {
            b = buf[i];
            if (b === PONTO_E_VIRGULA || b === LF || b === ASPAS) break;
          }
          const inicioTs = i + 1;
          const fimTs = inicioTs + TAMANHO_DO_TIMESTAMP;
          if (b === PONTO_E_VIRGULA && buf[fimTs] === PONTO_E_VIRGULA) {
            const chave = chaveDoTimestamp(buf, inicioTs, fimTs);
            const fimLat = Number.isNaN(chave) ? -1 : lerDecimalAteSeparador(buf, fimTs + 1, latitude, total);
            const fimLon = fimLat < 0 ? -1 : lerDecimalAteSeparador(buf, fimLat + 1, longitude, total);
            if (fimLon >= 0) {
              pessoa = conhecida;
              timestamp = timestamps.doFormatoPadrao(chave, buf, inicioTs, fimTs);
              const fimDaLinha = buf.indexOf(LF, fimLon);
              pos = fimDaLinha === -1 ? tamanho : fimDaLinha + 1;
              estatisticas.linhasDeDados++;
            }
          }
        }
      }
    }

    // ---- Caminho completo: tolerante a qualquer variação de formato.
    if (pessoa < 0) {
      const campos = localizarCampos(buf, pos, tamanho, inicioCampo, fimCampo);
      const inicioLinha = pos;
      const fimLinha = fimCampo[campos - 1];
      pos = fimLinha + 1;
      if (campos === 1 && linhaEmBranco(buf, inicioLinha, fimLinha)) continue;
      estatisticas.linhasDeDados++;

      // Pessoa
      const id = cId < campos ? lerInteiro(buf, inicioCampo[cId], fimCampo[cId]) : NaN;
      if (Number.isNaN(id)) {
        estatisticas.descartadas.idInvalido++;
        continue;
      }
      pessoa = pessoas.buscar(id);
      if (pessoa < 0) {
        // Primeira vez que esta pessoa aparece: facção, medida e restrições são da pessoa (não
        // da posição), então só são interpretadas aqui.
        const restricoes = cIds < campos ? lerListaDeIds(buf, inicioCampo[cIds], fimCampo[cIds]) : [];
        const medida = cMedida < campos && lerBooleano(buf, inicioCampo[cMedida], fimCampo[cMedida]);
        pessoa = pessoas.registrar({
          id,
          faccao: cFaccao < campos ? normalizarFaccao(lerTexto(buf, inicioCampo[cFaccao], fimCampo[cFaccao])) : null,
          vitima: medida || restricoes.length > 0,
          restricoes,
        });
      }

      // Timestamp
      if (cTimestamp < campos) {
        const s = inicioAparado(buf, inicioCampo[cTimestamp], fimCampo[cTimestamp]);
        const e = fimAparado(buf, s, fimCampo[cTimestamp]);
        if (s < e) {
          const chave = chaveDoTimestamp(buf, s, e);
          timestamp = Number.isNaN(chave) ? timestamps.doTexto(buf.toString('utf8', s, e)) : timestamps.doFormatoPadrao(chave, buf, s, e);
        }
      }
      if (timestamp < 0) {
        estatisticas.descartadas.timestampInvalido++;
        continue;
      }

      // Coordenadas: gravadas direto na próxima vaga dos arrays (se a linha for inválida, a vaga é reaproveitada).
      if (cLatitude < campos) lerDecimalPara(buf, inicioCampo[cLatitude], fimCampo[cLatitude], latitude, total);
      else latitude[total] = NaN;
      if (cLongitude < campos) lerDecimalPara(buf, inicioCampo[cLongitude], fimCampo[cLongitude], longitude, total);
      else longitude[total] = NaN;
    }

    // ---- Validação das coordenadas e registro da posição (comum aos dois caminhos).
    const lat = latitude[total];
    const lon = longitude[total];
    // NaN falha em todas as comparações, então também cai aqui. (0, 0) é o "GPS sem sinal" clássico.
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) || (lat === 0 && lon === 0)) {
      estatisticas.descartadas.coordenadaInvalida++;
      continue;
    }
    pessoaDaPosicao[total] = pessoa;
    timestampDaPosicao[total] = timestamp;
    total++;
    const latitudeAbsoluta = lat < 0 ? -lat : lat;
    if (latitudeAbsoluta > maiorLatitudeAbsoluta) maiorLatitudeAbsoluta = latitudeAbsoluta;
  }
  estatisticas.posicoesValidas = total;

  // 3) Atributos por pessoa em arrays tipados (consultados no laço quente do detector).
  const lista = pessoas.lista;
  const faccaoDaPessoa = new Int32Array(lista.length);
  const ehVitima = new Uint8Array(lista.length);
  const codigoDaFaccao = new Map<string, number>();
  lista.forEach((p, indice) => {
    if (p.faccao === null) {
      faccaoDaPessoa[indice] = -1;
    } else {
      let codigo = codigoDaFaccao.get(p.faccao);
      if (codigo === undefined) {
        codigo = codigoDaFaccao.size;
        codigoDaFaccao.set(p.faccao, codigo);
      }
      faccaoDaPessoa[indice] = codigo;
    }
    ehVitima[indice] = p.vitima ? 1 : 0;
  });

  return {
    pessoas: lista,
    indicePorId: pessoas.indicePorId,
    faccaoDaPessoa,
    ehVitima,
    totalPosicoes: total,
    pessoaDaPosicao,
    timestampDaPosicao,
    latitude,
    longitude,
    timestamps: timestamps.textos,
    maiorLatitudeAbsoluta,
    estatisticas,
  };
}

// ---------------------------------------------------------------------------------------------
// Leitura de campos direto dos bytes (exportadas para os testes)
// ---------------------------------------------------------------------------------------------

/** Inteiro do campo ("40", " 40 ", "\"40\"", "40.0"). NaN se não for um inteiro. */
export function lerInteiro(buf: Buffer, inicio: number, fim: number): number {
  let s = inicioAparado(buf, inicio, fim);
  const e = fimAparado(buf, s, fim);
  if (s >= e) return NaN;
  let negativo = false;
  if (buf[s] === MENOS) {
    negativo = true;
    s++;
  } else if (buf[s] === MAIS) {
    s++;
  }
  let valor = 0;
  let digitos = 0;
  let i = s;
  for (; i < e; i++) {
    const d = buf[i] - ZERO;
    if (d < 0 || d > 9) break;
    valor = valor * 10 + d;
    digitos++;
  }
  if (digitos === 0 || digitos > 15) return NaN;
  if (i < e) {
    // Só aceita parte decimal zerada ("40.0", "40,00").
    if (buf[i] !== PONTO && buf[i] !== VIRGULA) return NaN;
    for (i++; i < e; i++) if (buf[i] !== ZERO) return NaN;
  }
  return negativo ? -valor : valor;
}

const valorTemporario = new Float64Array(1);

/** Número decimal do campo ("-10.07996", "-10,07996", " \"-10.07996\" "). NaN se inválido. */
export function lerDecimal(buf: Buffer, inicio: number, fim: number): number {
  lerDecimalPara(buf, inicio, fim, valorTemporario, 0);
  return valorTemporario[0];
}

/**
 * Lê o número decimal do campo e grava em `destino[indice]`.
 *
 * Grava no array em vez de devolver o número porque, no laço principal (milhões de linhas), o V8
 * não consegue "embutir" esta função; aí cada double devolvido viraria um objeto alocado na
 * memória — e o garbage collector passaria a pesar no tempo total.
 *
 * Caminho rápido: monta o inteiro com todos os dígitos e divide por 10^casas. Como esse inteiro
 * (até 15 dígitos) e a potência de 10 são exatos em double, e a divisão IEEE-754 é corretamente
 * arredondada, o resultado é idêntico ao de Number()/parseFloat() — testado em
 * tests/leitura.test.ts. Formatos incomuns (ex.: notação científica) caem no Number().
 */
export function lerDecimalPara(buf: Buffer, inicio: number, fim: number, destino: Float64Array, indice: number): void {
  let s = inicioAparado(buf, inicio, fim);
  const e = fimAparado(buf, s, fim);
  if (s >= e) {
    destino[indice] = NaN;
    return;
  }
  const inicioDoTexto = s;
  let negativo = false;
  if (buf[s] === MENOS) {
    negativo = true;
    s++;
  } else if (buf[s] === MAIS) {
    s++;
  }
  let mantissa = 0;
  let digitos = 0;
  let casas = 0;
  let temSeparador = false;
  for (let i = s; i < e; i++) {
    const b = buf[i];
    const d = b - ZERO;
    if (d >= 0 && d <= 9) {
      mantissa = mantissa * 10 + d;
      digitos++;
      if (temSeparador) casas++;
    } else if ((b === PONTO || b === VIRGULA) && !temSeparador) {
      temSeparador = true;
    } else {
      destino[indice] = lerDecimalGenerico(buf, inicioDoTexto, e); // formato incomum (raro)
      return;
    }
  }
  if (digitos === 0) {
    destino[indice] = NaN;
  } else if (digitos > 15) {
    destino[indice] = lerDecimalGenerico(buf, inicioDoTexto, e);
  } else {
    const valor = mantissa / POTENCIA_DE_10[casas];
    destino[indice] = negativo ? -valor : valor;
  }
}

/**
 * Versão estrita de `lerDecimalPara`, usada no caminho rápido: aceita só `-?dígitos(.dígitos)?`
 * terminado em ";" (até 15 dígitos). Grava o valor em `destino[indice]` e devolve a posição do
 * ";" — ou -1 se o campo fugir desse formato (aí a linha vai para o caminho completo).
 * Para tudo o que aceita, o valor é idêntico ao de `lerDecimalPara`.
 */
function lerDecimalAteSeparador(buf: Buffer, inicio: number, destino: Float64Array, indice: number): number {
  let i = inicio;
  let negativo = false;
  if (buf[i] === MENOS) {
    negativo = true;
    i++;
  }
  let mantissa = 0;
  let digitos = 0;
  let casas = 0;
  let temPonto = false;
  for (; ; i++) {
    const b = buf[i];
    const d = b - ZERO;
    if (d >= 0 && d <= 9) {
      mantissa = mantissa * 10 + d;
      digitos++;
      if (temPonto) casas++;
    } else if (b === PONTO && !temPonto) {
      temPonto = true;
    } else if (b === PONTO_E_VIRGULA) {
      break;
    } else {
      return -1; // inclui o fim do arquivo (buf[i] === undefined)
    }
  }
  if (digitos === 0 || digitos > 15) return -1;
  const valor = mantissa / POTENCIA_DE_10[casas];
  destino[indice] = negativo ? -valor : valor;
  return i;
}

/** medidaProtetiva: true/1/sim/S/yes/verdadeiro → true; qualquer outra coisa (ou vazio) → false. */
export function lerBooleano(buf: Buffer, inicio: number, fim: number): boolean {
  const s = inicioAparado(buf, inicio, fim);
  if (s >= fimAparado(buf, s, fim)) return false;
  switch (buf[s]) {
    case 0x74: // t (true)
    case 0x54: // T
    case 0x73: // s (sim)
    case 0x53: // S
    case 0x79: // y (yes)
    case 0x59: // Y
    case 0x76: // v (verdadeiro)
    case 0x56: // V
    case 0x31: // 1
      return true;
    default:
      return false;
  }
}

/** idsRestricaoMedida: extrai os inteiros de "1,2,3", "[1, 2, 3]", "\"1,2,3\"" ou "1.0,2.0". */
export function lerListaDeIds(buf: Buffer, inicio: number, fim: number): number[] {
  const ids: number[] = [];
  let i = inicio;
  while (i < fim) {
    while (i < fim && !ehDigito(buf[i])) i++;
    if (i >= fim) break;
    let valor = 0;
    let digitos = 0;
    while (i < fim && ehDigito(buf[i])) {
      valor = valor * 10 + (buf[i] - ZERO);
      digitos++;
      i++;
    }
    let inteiro = true;
    if (i < fim && buf[i] === PONTO) {
      // "3.0" é aceito como 3; "3.5" não é um id válido.
      for (i++; i < fim && ehDigito(buf[i]); i++) if (buf[i] !== ZERO) inteiro = false;
    }
    if (inteiro && digitos <= 15) ids.push(valor);
  }
  return ids;
}

export function normalizarFaccao(texto: string): string | null {
  const faccao = texto.trim().toUpperCase();
  return VALORES_SEM_FACCAO.has(faccao) ? null : faccao;
}

// ---------------------------------------------------------------------------------------------
// Auxiliares internos
// ---------------------------------------------------------------------------------------------

function paraBuffer(conteudo: Uint8Array | string): Buffer {
  if (typeof conteudo === 'string') return Buffer.from(conteudo, 'utf8');
  if (Buffer.isBuffer(conteudo)) return conteudo;
  return Buffer.from(conteudo.buffer, conteudo.byteOffset, conteudo.byteLength);
}

function temBom(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

function contarLinhas(buf: Buffer): number {
  let linhas = 1;
  for (let i = buf.indexOf(LF); i !== -1; i = buf.indexOf(LF, i + 1)) linhas++;
  return linhas;
}

/**
 * Marca onde começa e termina cada campo da linha que começa em `inicio` e devolve quantos campos
 * ela tem. O fim do último campo é o fim da linha (posição do \n ou do fim do arquivo).
 * Um ";" entre aspas não separa campos.
 */
function localizarCampos(
  buf: Buffer,
  inicio: number,
  tamanho: number,
  inicioCampo: Int32Array,
  fimCampo: Int32Array,
): number {
  let campos = 0;
  let entreAspas = false;
  inicioCampo[0] = inicio;
  let i = inicio;
  for (; i < tamanho; i++) {
    const b = buf[i];
    if (b === LF) break;
    if (b === PONTO_E_VIRGULA) {
      if (!entreAspas && campos < MAX_CAMPOS - 1) {
        fimCampo[campos] = i;
        campos++;
        inicioCampo[campos] = i + 1;
      }
    } else if (b === ASPAS) {
      entreAspas = !entreAspas;
    }
  }
  fimCampo[campos] = i;
  return campos + 1;
}

function mapearColunas(
  buf: Buffer,
  inicioCampo: Int32Array,
  fimCampo: Int32Array,
  campos: number,
): number[] | null {
  const coluna = new Array<number>(COLUNAS_DO_ENUNCIADO.length).fill(-1);
  for (let c = 0; c < campos; c++) {
    const nome = lerTexto(buf, inicioCampo[c], fimCampo[c])
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    const papel = NOMES_DE_COLUNA.get(nome);
    if (papel !== undefined && coluna[papel] === -1) coluna[papel] = c;
  }
  // Sem as colunas essenciais, o cabeçalho não é confiável: usa a ordem do enunciado.
  if (coluna[ID] < 0 || coluna[TIMESTAMP] < 0 || coluna[LATITUDE] < 0 || coluna[LONGITUDE] < 0) return null;
  return coluna.map((c) => (c < 0 ? COLUNA_AUSENTE : c));
}

/**
 * "YYYY-MM-DD HH:MM:SS" → número inteiro único para aquele instante, sem criar string.
 * Devolve NaN se o texto fugir do formato (aí o timestamp é tratado pelo texto exato).
 *
 * A chave é uma contagem de segundos "mista" (ano, mês de 31 dias, horas…) a partir de 2000;
 * como cada componente é validado no seu intervalo, textos diferentes nunca geram a mesma chave.
 * Para datas entre 1935 e 2065 ela cabe num inteiro pequeno (SMI) do V8, o que evita alocar um
 * número na memória a cada linha.
 */
function chaveDoTimestamp(buf: Buffer, s: number, e: number): number {
  if (
    e - s !== TAMANHO_DO_TIMESTAMP ||
    buf[s + 4] !== MENOS ||
    buf[s + 7] !== MENOS ||
    buf[s + 10] !== ESPACO ||
    buf[s + 13] !== DOIS_PONTOS ||
    buf[s + 16] !== DOIS_PONTOS
  ) {
    return NaN;
  }
  for (let k = 0; k < DIGITOS_DO_TIMESTAMP.length; k++) {
    const d = buf[s + DIGITOS_DO_TIMESTAMP[k]] - ZERO;
    if (d < 0 || d > 9) return NaN;
  }
  const ano = doisDigitos(buf, s) * 100 + doisDigitos(buf, s + 2);
  const mes = doisDigitos(buf, s + 5);
  const dia = doisDigitos(buf, s + 8);
  const hora = doisDigitos(buf, s + 11);
  const minuto = doisDigitos(buf, s + 14);
  const segundo = doisDigitos(buf, s + 17);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59 || segundo > 59) return NaN;
  return (((ano - 2000) * 12 + (mes - 1)) * 31 + (dia - 1)) * 86_400 + hora * 3600 + minuto * 60 + segundo;
}

function doisDigitos(buf: Buffer, i: number): number {
  return (buf[i] - ZERO) * 10 + (buf[i + 1] - ZERO);
}

function lerDecimalGenerico(buf: Buffer, inicio: number, fim: number): number {
  const texto = buf.toString('latin1', inicio, fim).replace(',', '.');
  return texto === '' ? NaN : Number(texto);
}

function lerTexto(buf: Buffer, inicio: number, fim: number): string {
  const s = inicioAparado(buf, inicio, fim);
  const e = fimAparado(buf, s, fim);
  return s < e ? buf.toString('utf8', s, e) : '';
}

function linhaEmBranco(buf: Buffer, inicio: number, fim: number): boolean {
  for (let i = inicio; i < fim; i++) {
    const b = buf[i];
    if (b !== ESPACO && b !== TAB && b !== CR) return false;
  }
  return true;
}

/** Caracteres ignorados nas bordas de um campo: espaço, tab, \r e aspas. */
function ignoradoNaBorda(b: number): boolean {
  return b === ESPACO || b === TAB || b === CR || b === ASPAS;
}

function inicioAparado(buf: Buffer, inicio: number, fim: number): number {
  while (inicio < fim && ignoradoNaBorda(buf[inicio])) inicio++;
  return inicio;
}

function fimAparado(buf: Buffer, inicio: number, fim: number): number {
  while (fim > inicio && ignoradoNaBorda(buf[fim - 1])) fim--;
  return fim;
}

function ehDigito(b: number): boolean {
  return b >= ZERO && b <= ZERO + 9;
}
