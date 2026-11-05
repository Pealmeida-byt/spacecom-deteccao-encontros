import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarAleatorio } from '../ferramentas/gerar-dataset.js';
import {
  distanciaHaversine,
  janelaLatitudeGraus,
  janelaLongitudeGraus,
  RAIO_TERRA_METROS,
} from '../src/geo.js';

test('reproduz bit a bit a distância do exemplo do enunciado (monitorados 40 e 44)', () => {
  assert.equal(distanciaHaversine(-10.07996, -37.08384, -10.07987, -37.08389), 11.406788673336607);
});

test('distância é simétrica e zero para o mesmo ponto', () => {
  assert.equal(distanciaHaversine(-10.1, -37.1, -10.1, -37.1), 0);
  const ida = distanciaHaversine(-10.07996, -37.08384, -10.07987, -37.08389);
  const volta = distanciaHaversine(-10.07987, -37.08389, -10.07996, -37.08384);
  assert.equal(ida, volta);
});

test('usa o raio de 6.371.000 m: 1 grau de latitude = R·π/180', () => {
  const umGrau = distanciaHaversine(0, 0, 1, 0);
  assert.ok(Math.abs(umGrau - (RAIO_TERRA_METROS * Math.PI) / 180) < 1e-6);
});

test('as janelas do pré-filtro nunca descartam um par a menos de 20 m (500 mil pares aleatórios)', () => {
  const aleatorio = criarAleatorio(7);
  const janelaLatitude = janelaLatitudeGraus();
  let paresProximos = 0;
  for (let k = 0; k < 500_000; k++) {
    const lat1 = (aleatorio() - 0.5) * 160; // até ±80°
    const lon1 = (aleatorio() - 0.5) * 360;
    const angulo = aleatorio() * 2 * Math.PI;
    const metros = aleatorio() * 22;
    const lat2 = lat1 + ((Math.cos(angulo) * metros) / RAIO_TERRA_METROS) * (180 / Math.PI);
    const lon2 =
      lon1 + ((Math.sin(angulo) * metros) / (RAIO_TERRA_METROS * Math.cos((lat1 * Math.PI) / 180))) * (180 / Math.PI);
    if (distanciaHaversine(lat1, lon1, lat2, lon2) >= 20) continue;
    paresProximos++;
    const janelaLongitude = janelaLongitudeGraus(Math.max(Math.abs(lat1), Math.abs(lat2)));
    assert.ok(Math.abs(lat2 - lat1) <= janelaLatitude, `latitude fora da janela em ${lat1},${lon1}`);
    assert.ok(Math.abs(lon2 - lon1) <= janelaLongitude, `longitude fora da janela em ${lat1},${lon1}`);
  }
  assert.ok(paresProximos > 350_000);
});

test('janela de latitude para 20 m fica na 5ª casa decimal (≈ 0,00018°)', () => {
  const janela = janelaLatitudeGraus();
  assert.ok(janela > 0.000179 && janela < 0.000181);
});
