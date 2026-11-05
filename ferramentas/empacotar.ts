/**
 * Gera o .zip de entrega com o código-fonte, o README e os JSONs de saída.
 *
 * Fica de fora: node_modules, dist (JavaScript compilado), data (datasets da Spacecom) e
 * relatorios. Não vai nenhum .js no pacote — o e-mail do desafio avisa que provedores bloqueiam
 * anexos com .js (o Gmail bloqueia até dentro de .zip).
 *
 * O formato ZIP é escrito aqui mesmo (com o zlib do Node) para não depender de nenhuma
 * ferramenta externa — funciona igual no Windows, Linux e macOS.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { megabytes, PASTA_ENTREGA, PASTA_SAIDA } from './comum.js';

const NOME_DO_PACOTE = 'spacecom-deteccao-encontros-pedro-almeida';
const ARQUIVOS_DA_RAIZ = ['README.md', 'package.json', 'package-lock.json', 'tsconfig.json', '.gitignore'];
const PASTAS_DE_CODIGO = ['src', 'ferramentas', 'tests'];
const LIMITE_DE_ANEXO = 20 * 1024 * 1024;

function listar(pasta: string, filtro: (arquivo: string) => boolean): string[] {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta, { withFileTypes: true })
    .flatMap((item) => {
      const caminho = join(pasta, item.name);
      return item.isDirectory() ? listar(caminho, filtro) : filtro(caminho) ? [caminho] : [];
    })
    .sort();
}

// ------------------------------------------------------------------ ZIP (APPNOTE da PKWARE)

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(dados: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < dados.length; i++) crc = TABELA_CRC[(crc ^ dados[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dataHoraDos(data: Date): { hora: number; dia: number } {
  return {
    hora: (data.getHours() << 11) | (data.getMinutes() << 5) | Math.floor(data.getSeconds() / 2),
    dia: ((Math.max(1980, data.getFullYear()) - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate(),
  };
}

function criarZip(entradas: { nome: string; dados: Buffer }[]): Buffer {
  const partes: Buffer[] = [];
  const diretorio: Buffer[] = [];
  let deslocamento = 0;
  const { hora, dia } = dataHoraDos(new Date());

  for (const { nome, dados } of entradas) {
    const nomeBytes = Buffer.from(nome, 'utf8');
    const comprimido = deflateRawSync(dados, { level: 9 });
    const usarDeflate = comprimido.length < dados.length;
    const conteudo = usarDeflate ? comprimido : dados;
    const crc = crc32(dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(usarDeflate ? 8 : 0, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(conteudo.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBytes.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nomeBytes, conteudo);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // feito por (MS-DOS/FAT, compatível com tudo)
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(usarDeflate ? 8 : 0, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(dia, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(conteudo.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nomeBytes.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    diretorio.push(central, nomeBytes);

    deslocamento += local.length + nomeBytes.length + conteudo.length;
  }

  const tamanhoDiretorio = diretorio.reduce((s, b) => s + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(tamanhoDiretorio, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, ...diretorio, fim]);
}

// ------------------------------------------------------------------ montagem do pacote

function principal(): void {
  const arquivos = [
    ...ARQUIVOS_DA_RAIZ.filter((a) => existsSync(a)),
    ...PASTAS_DE_CODIGO.flatMap((pasta) => listar(pasta, (a) => a.endsWith('.ts'))),
    ...listar(PASTA_SAIDA, (a) => a.endsWith('.json')),
  ];
  const proibidos = arquivos.filter((a) => /\.(js|mjs|cjs)$/i.test(a));
  if (proibidos.length > 0) throw new Error(`O pacote não pode ter .js (bloqueado por e-mail): ${proibidos.join(', ')}`);
  const saidas = arquivos.filter((a) => a.startsWith(PASTA_SAIDA));
  if (saidas.length === 0) console.warn(`⚠ Nenhum JSON em ${PASTA_SAIDA}/ — rode "npm start" antes, para incluir os resultados.`);

  const entradas = arquivos.map((arquivo) => ({
    nome: `${NOME_DO_PACOTE}/${relative('.', arquivo).split(sep).join('/')}`,
    dados: readFileSync(arquivo),
  }));
  const zip = criarZip(entradas);
  mkdirSync(PASTA_ENTREGA, { recursive: true });
  const destino = join(PASTA_ENTREGA, `${NOME_DO_PACOTE}.zip`);
  writeFileSync(destino, zip);

  const tamanhoOriginal = entradas.reduce((s, e) => s + e.dados.length, 0);
  console.log(`📦 ${destino} — ${entradas.length} arquivos, ${megabytes(statSync(destino).size)} (${megabytes(tamanhoOriginal)} sem compressão)`);
  console.log(`   inclui: ${ARQUIVOS_DA_RAIZ.filter((a) => existsSync(a)).join(', ')}, ${PASTAS_DE_CODIGO.join('/, ')}/ e ${saidas.length} JSON(s) de ${PASTA_SAIDA}/`);
  if (zip.length > LIMITE_DE_ANEXO) {
    console.warn('   ⚠ O .zip passou de 20 MB: envie por link (Google Drive/OneDrive) em vez de anexo.');
  }
}

principal();
