import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gerarDataset } from '../ferramentas/gerar-dataset.js';
import { detectarEncontros } from '../src/detector.js';
import { interpretarDataset } from '../src/leitura.js';
import { gravarEncontros, paraSaida, serializarEncontros } from '../src/saida.js';
import { arquivo } from './auxiliares.js';

test('a gravação em blocos gera exatamente o mesmo arquivo (inclusive nas bordas dos blocos)', () => {
  const ds = interpretarDataset(gerarDataset({ semente: 9, pessoas: 120, timestamps: 120, ladoAreaMetros: 150 }));
  const { encontros } = detectarEncontros(ds);
  assert.ok(encontros.length > 8193, `poucos encontros: ${encontros.length}`);
  const pasta = mkdtempSync(join(tmpdir(), 'encontros-'));
  try {
    for (const quantidade of [0, 1, 4095, 4096, 4097, 8192, 8193, encontros.length]) {
      const parte = encontros.slice(0, quantidade);
      const caminho = join(pasta, `saida-${quantidade}.json`);
      gravarEncontros(caminho, ds, parte);
      const gravado = readFileSync(caminho, 'utf8');
      assert.equal(gravado, serializarEncontros(ds, parte), `quantidade ${quantidade}`);
      assert.equal(JSON.parse(gravado).length, quantidade);
    }
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('o texto gerado é JSON válido e idêntico a JSON.stringify dos objetos', () => {
  const ds = interpretarDataset(gerarDataset({ semente: 5, pessoas: 80, timestamps: 60, ladoAreaMetros: 200 }));
  const { encontros } = detectarEncontros(ds);
  assert.ok(encontros.length > 100);
  const texto = serializarEncontros(ds, encontros);
  assert.deepEqual(JSON.parse(texto), paraSaida(ds, encontros));
  // Mesmo texto, campo a campo, que o JSON.stringify produziria (um encontro por linha).
  const esperado = `[\n${paraSaida(ds, encontros)
    .map((e) => JSON.stringify(e))
    .join(',\n')}\n]\n`;
  assert.equal(texto, esperado);
});

test('linha do exemplo do enunciado sai exatamente com os campos e valores esperados', () => {
  const ds = interpretarDataset(
    arquivo('40;7;2024-01-01 00:01:50;-10.07996;-37.08384;false;', '44;7;2024-01-01 00:01:50;-10.07987;-37.08389;false;'),
  );
  assert.equal(
    serializarEncontros(ds, detectarEncontros(ds).encontros),
    '[\n{"tipo":"faccao","monitoradosEncontro":[40,44],"timestamp":"2024-01-01 00:01:50",' +
      '"posicoes":{"40":{"lat":-10.07996,"lon":-37.08384},"44":{"lat":-10.07987,"lon":-37.08389}},' +
      '"distanciaMetros":11.406788673336607}\n]\n',
  );
});

test('sem encontros → []', () => {
  const ds = interpretarDataset(arquivo());
  assert.equal(serializarEncontros(ds, []), '[]\n');
});
