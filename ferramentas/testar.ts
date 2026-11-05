/**
 * Roda os testes automatizados (node:test) compilados em dist/tests.
 * Lista os arquivos aqui para funcionar igual em qualquer sistema e versão do Node.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pasta = fileURLToPath(new URL('../tests/', import.meta.url));
const arquivos = readdirSync(pasta)
  .filter((nome) => nome.endsWith('.test.js'))
  .sort()
  .map((nome) => join(pasta, nome));

const extras = process.argv.slice(2);
const execucao = spawnSync(process.execPath, ['--test', ...extras, ...arquivos], { stdio: 'inherit' });
process.exitCode = execucao.status ?? 1;
