/**
 * Baixa os 7 datasets e as 2 respostas de exemplo (links do e-mail do desafio) para data/.
 * Arquivos que já existem são mantidos; use --forcar para baixar de novo.
 */
import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as ReadableStreamWeb } from 'node:stream/web';
import { ARQUIVOS_DO_DESAFIO, megabytes, PASTA_DADOS, URL_DOS_ARQUIVOS } from './comum.js';

async function baixar(nome: string, forcar: boolean): Promise<boolean> {
  const destino = join(PASTA_DADOS, nome);
  if (!forcar && existsSync(destino) && statSync(destino).size > 0) {
    console.log(`  ✓ ${nome.padEnd(16)} já existe (${megabytes(statSync(destino).size)})`);
    return true;
  }
  const url = `${URL_DOS_ARQUIVOS}/${nome}`;
  const parcial = `${destino}.parcial`;
  try {
    const resposta = await fetch(url);
    if (!resposta.ok || !resposta.body) throw new Error(`HTTP ${resposta.status} ${resposta.statusText}`);
    await pipeline(Readable.fromWeb(resposta.body as unknown as ReadableStreamWeb<Uint8Array>), createWriteStream(parcial));
    if (pareceErroDoS3(parcial)) throw new Error('o servidor devolveu uma página de erro em vez do arquivo');
    renameSync(parcial, destino);
    console.log(`  ✓ ${nome.padEnd(16)} baixado (${megabytes(statSync(destino).size)})`);
    return true;
  } catch (erro) {
    rmSync(parcial, { force: true });
    console.error(`  ✗ ${nome.padEnd(16)} falhou: ${erro instanceof Error ? erro.message : String(erro)}`);
    console.error(`    → baixe manualmente em ${url} e salve como ${destino}`);
    return false;
  }
}

function pareceErroDoS3(caminho: string): boolean {
  const arquivo = openSync(caminho, 'r');
  try {
    const inicio = Buffer.alloc(256);
    const lidos = readSync(arquivo, inicio, 0, inicio.length, 0);
    const texto = inicio.subarray(0, lidos).toString('utf8');
    return texto.includes('<Error>') && texto.includes('<Code>');
  } finally {
    closeSync(arquivo);
  }
}

async function principal(): Promise<void> {
  const forcar = process.argv.includes('--forcar');
  mkdirSync(PASTA_DADOS, { recursive: true });
  console.log(`Baixando os arquivos do desafio para ${PASTA_DADOS}/ …`);
  let falhas = 0;
  for (const nome of ARQUIVOS_DO_DESAFIO) if (!(await baixar(nome, forcar))) falhas++;
  if (falhas > 0) {
    console.error(`\n${falhas} arquivo(s) não foram baixados. Os que estão em ${PASTA_DADOS}/ serão usados normalmente.`);
    process.exitCode = 1;
  }
}

await principal();
