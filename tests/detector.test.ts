import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arquivo, detectar, maisMetrosAoNorte } from './auxiliares.js';

const T0 = '2024-01-01 00:01:50';
const T1 = '2024-01-01 00:01:55';
const LAT = -10.07996;
const LON = -37.08384;

/** Linha de um monitorado de tornozeleira. */
const monitorado = (id: number, faccao: string, timestamp: string, lat: number, lon: number = LON): string =>
  `${id};${faccao};${timestamp};${lat};${lon};false;`;
/** Linha de uma vítima com medida protetiva. */
const vitima = (id: number, agressores: string, timestamp: string, lat: number, lon: number = LON): string =>
  `${id};;${timestamp};${lat};${lon};true;${agressores}`;

test('exemplo do enunciado: 40 e 44 da mesma facção a 11,4 m → encontro de facção', () => {
  const saida = detectar(arquivo(monitorado(40, '7', T0, -10.07996, -37.08384), monitorado(44, '7', T0, -10.07987, -37.08389)));
  assert.deepEqual(saida, [
    {
      tipo: 'faccao',
      monitoradosEncontro: [40, 44],
      timestamp: '2024-01-01 00:01:50',
      posicoes: { '40': { lat: -10.07996, lon: -37.08384 }, '44': { lat: -10.07987, lon: -37.08389 } },
      distanciaMetros: 11.406788673336607,
    },
  ]);
});

test('monitorados de facções diferentes ou sem facção → encontro genérico', () => {
  const saida = detectar(
    arquivo(
      monitorado(1, '7', T0, LAT),
      monitorado(2, '3', T0, maisMetrosAoNorte(LAT, 5)),
      monitorado(3, '', T0, maisMetrosAoNorte(LAT, 10)),
      monitorado(4, 'null', T0, maisMetrosAoNorte(LAT, 15)),
    ),
  );
  assert.equal(saida.length, 6);
  assert.ok(saida.every((e) => e.tipo === 'generico'));
});

test('agressor perto da sua vítima → encontro de medida protetiva (lista em qualquer formato)', () => {
  const saida = detectar(
    arquivo(
      monitorado(10, '7', T0, LAT),
      monitorado(11, '', T0, maisMetrosAoNorte(LAT, 30)),
      vitima(90, '"10,12"', T0, maisMetrosAoNorte(LAT, 8)),
      vitima(91, '[11]', T0, maisMetrosAoNorte(LAT, 36)),
    ),
  );
  assert.deepEqual(
    saida.map((e) => [e.tipo, ...e.monitoradosEncontro]),
    [
      ['protetiva', 10, 90],
      ['protetiva', 11, 91],
    ],
  );
});

test('protetiva tem prioridade: o par aparece uma única vez', () => {
  // 20 (tornozeleira) tem medida protetiva contra 21 — e os dois são da mesma facção.
  const saida = detectar(arquivo(`20;7;${T0};${LAT};${LON};true;21`, monitorado(21, '7', T0, maisMetrosAoNorte(LAT, 3))));
  assert.deepEqual(
    saida.map((e) => e.tipo),
    ['protetiva'],
  );
});

test('vítima perto de quem não é seu agressor, ou de outra vítima → não é encontro', () => {
  const saida = detectar(
    arquivo(
      monitorado(1, '7', T0, LAT),
      vitima(90, '99', T0, maisMetrosAoNorte(LAT, 2)),
      vitima(91, '98', T0, maisMetrosAoNorte(LAT, 4)),
    ),
  );
  assert.deepEqual(saida, []);
});

test('limite de 20 m: 19,9 m é encontro; 20,1 m não é', () => {
  const perto = detectar(arquivo(monitorado(1, '', T0, LAT), monitorado(2, '', T0, maisMetrosAoNorte(LAT, 19.9))));
  const longe = detectar(arquivo(monitorado(1, '', T0, LAT), monitorado(2, '', T0, maisMetrosAoNorte(LAT, 20.1))));
  assert.equal(perto.length, 1);
  assert.ok(perto[0].distanciaMetros < 20 && perto[0].distanciaMetros > 19.8);
  assert.equal(longe.length, 0);
});

test('perto em longitude também conta (e longe em longitude não)', () => {
  const metrosPorGrauLon = ((6_371_000 * Math.PI) / 180) * Math.cos((LAT * Math.PI) / 180);
  const perto = detectar(arquivo(monitorado(1, '', T0, LAT, LON), monitorado(2, '', T0, LAT, LON + 15 / metrosPorGrauLon)));
  const longe = detectar(arquivo(monitorado(1, '', T0, LAT, LON), monitorado(2, '', T0, LAT, LON + 25 / metrosPorGrauLon)));
  assert.equal(perto.length, 1);
  assert.equal(longe.length, 0);
});

test('só compara posições do MESMO timestamp', () => {
  const saida = detectar(arquivo(monitorado(1, '7', T0, LAT), monitorado(2, '7', T1, LAT)));
  assert.deepEqual(saida, []);
});

test('o mesmo par em timestamps diferentes gera um registro por timestamp', () => {
  const saida = detectar(
    arquivo(
      monitorado(1, '7', T0, LAT),
      monitorado(2, '7', T0, maisMetrosAoNorte(LAT, 5)),
      monitorado(1, '7', T1, LAT),
      monitorado(2, '7', T1, maisMetrosAoNorte(LAT, 6)),
    ),
  );
  assert.deepEqual(
    saida.map((e) => e.timestamp),
    [T0, T1],
  );
});

test('linha repetida da mesma pessoa no mesmo timestamp não duplica o encontro (vale a primeira)', () => {
  const saida = detectar(
    arquivo(
      monitorado(1, '7', T0, LAT),
      monitorado(2, '7', T0, maisMetrosAoNorte(LAT, 5)),
      monitorado(2, '7', T0, maisMetrosAoNorte(LAT, 5)),
      monitorado(1, '7', T0, maisMetrosAoNorte(LAT, 1)),
    ),
  );
  assert.equal(saida.length, 1);
  assert.equal(saida[0].posicoes['1'].lat, LAT);
});

test('saída em ordem cronológica e, no mesmo timestamp, pelos ids — mesmo com o arquivo fora de ordem', () => {
  const linhas = [
    monitorado(5, '', T1, LAT),
    monitorado(3, '', T1, maisMetrosAoNorte(LAT, 2)),
    monitorado(9, '', T0, LAT),
    monitorado(2, '', T0, maisMetrosAoNorte(LAT, 1)),
    monitorado(7, '', T0, maisMetrosAoNorte(LAT, 3)),
  ];
  const saida = detectar(arquivo(...linhas));
  assert.deepEqual(
    saida.map((e) => `${e.timestamp} ${e.monitoradosEncontro.join('-')}`),
    [`${T0} 2-7`, `${T0} 2-9`, `${T0} 7-9`, `${T1} 3-5`],
  );
  assert.deepEqual(detectar(arquivo(...linhas.reverse())), saida);
});

test('arquivo sem posições válidas → array vazio', () => {
  assert.deepEqual(detectar(arquivo()), []);
  assert.deepEqual(detectar(''), []);
});
