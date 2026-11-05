import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarAleatorio, gerarDataset } from '../ferramentas/gerar-dataset.js';
import {
  interpretarDataset,
  lerBooleano,
  lerDecimal,
  lerInteiro,
  lerListaDeIds,
  normalizarFaccao,
  type Dataset,
} from '../src/leitura.js';
import { arquivo } from './auxiliares.js';

/** Tudo o que a leitura produz, em forma comparável. */
function resumo(ds: Dataset): unknown {
  const n = ds.totalPosicoes;
  return {
    pessoas: ds.pessoas,
    faccao: [...ds.faccaoDaPessoa],
    vitima: [...ds.ehVitima],
    timestamps: ds.timestamps,
    pessoaDaPosicao: [...ds.pessoaDaPosicao.subarray(0, n)],
    timestampDaPosicao: [...ds.timestampDaPosicao.subarray(0, n)],
    latitude: [...ds.latitude.subarray(0, n)],
    longitude: [...ds.longitude.subarray(0, n)],
    maiorLatitudeAbsoluta: ds.maiorLatitudeAbsoluta,
    estatisticas: ds.estatisticas,
  };
}

test('caminho rápido ≡ caminho completo em 30 datasets aleatórios (limpos e sujos)', () => {
  for (let semente = 1; semente <= 30; semente++) {
    const texto = gerarDataset({ semente, pessoas: 30 + semente, timestamps: 30, ruido: semente % 2 === 0 });
    assert.deepEqual(resumo(interpretarDataset(texto)), resumo(interpretarDataset(texto, { caminhoRapido: false })), `semente ${semente}`);
  }
});

test('caminho rápido ≡ caminho completo em linhas que fogem do formato estrito em cada ponto', () => {
  const texto = arquivo(
    '40;7;2024-01-01 00:00:00;-10.07996;-37.08384;false;', // 1ª linha da pessoa (sempre caminho completo)
    '40;7;2024-01-01 00:00:05;-10.07996;-37.08384;false;', // limpa → caminho rápido
    '40;"7";2024-01-01 00:00:10;-10.07996;-37.08384;false;', // aspas na facção
    '40;7; 2024-01-01 00:00:15;-10.07996;-37.08384;false;', // espaço antes do timestamp
    '40;7;2024-01-01 00:00:20 ;-10.07996;-37.08384;false;', // espaço depois do timestamp
    '40;7;2024-01-01T00:00:25;-10.07996;-37.08384;false;', // timestamp fora do padrão
    '40;7;2024-13-01 00:00:30;-10.07996;-37.08384;false;', // mês inválido
    '40;7;2024-01-01 00:00:35;-10,07996;-37.08384;false;', // vírgula decimal
    '40;7;2024-01-01 00:00:40;-10.07996;"-37.08384";false;', // aspas na longitude
    '40;7;2024-01-01 00:00:45;-10.07996;-37.08384', // linha sem os últimos campos
    '40;7;2024-01-01 00:00:50;;-37.08384;false;', // latitude vazia
    '40;7;2024-01-01 00:00:55;0;0;false;', // (0, 0)
    '40;7;2024-01-01 00:01:00;95.0;-37.08384;false;', // fora da faixa
    '40;7;2024-01-01 00:01:05;1e1;-37.08384;false;', // notação científica
    '40;7;2024-01-01 00:01:10;-10.0799600000000001;-37.08384;false;', // mais de 15 dígitos
    '040;7;2024-01-01 00:01:15;-10.07996;-37.08384;false;', // zero à esquerda no id
    '0000000000000040;7;2024-01-01 00:01:20;-10.07996;-37.08384;false;', // id com 16 dígitos
    '40;7;2024-01-01 00:01:25;-10.07996;-37.08384;false;\r', // \r\n
    '   ',
    '40;7;2024-01-01 00:01:30;-.5;5.;false;', // formatos curtos
    '40;7;2024-01-01 00:01:35;-10.07996;-37.08384;false;"1;2"', // ";" entre aspas depois da longitude
    '40;7;2024-01-01 00:01:40;-10.07996;-37.08384', // fim do arquivo sem \n
  ).replace(/\n$/, '');
  const rapido = interpretarDataset(texto);
  assert.deepEqual(resumo(rapido), resumo(interpretarDataset(texto, { caminhoRapido: false })));
  assert.ok(rapido.totalPosicoes > 10);
});

const campo = (texto: string): [Buffer, number, number] => {
  const buf = Buffer.from(texto, 'utf8');
  return [buf, 0, buf.length];
};

test('lê o formato do enunciado: pessoas, atributos e posições', () => {
  const ds = interpretarDataset(
    arquivo(
      '40;7;2024-01-01 00:01:50;-10.07996;-37.08384;false;',
      '90;;2024-01-01 00:01:50;-10.07993;-37.08386;true;40,44',
    ),
  );
  assert.equal(ds.estatisticas.cabecalho?.startsWith('idMonitorado'), true);
  assert.equal(ds.totalPosicoes, 2);
  assert.deepEqual(ds.pessoas, [
    { id: 40, faccao: '7', vitima: false, restricoes: [] },
    { id: 90, faccao: null, vitima: true, restricoes: [40, 44] },
  ]);
  assert.deepEqual(ds.timestamps, ['2024-01-01 00:01:50']);
  assert.equal(ds.latitude[0], -10.07996);
  assert.equal(ds.longitude[1], -37.08386);
});

test('tolera BOM, \\r\\n, linhas em branco, espaços, aspas e vírgula decimal', () => {
  const texto =
    '﻿idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida\r\n' +
    '\r\n' +
    ' "40" ; 7 ;"2024-01-01 00:01:50"; -10,07996 ;"-37.08384";FALSE;\r\n' +
    '   \r\n' +
    '41;7;2024-01-01 00:01:50;-10.07996;-37.08384;N;\r\n';
  const ds = interpretarDataset(texto);
  assert.equal(ds.totalPosicoes, 2);
  assert.equal(ds.estatisticas.linhasDeDados, 2);
  assert.equal(ds.latitude[0], -10.07996);
  assert.equal(ds.longitude[0], -37.08384);
  assert.deepEqual(ds.timestamps, ['2024-01-01 00:01:50']);
  assert.equal(ds.pessoas[0].faccao, '7');
});

test('descarta e conta linhas inválidas (id, timestamp, coordenada, 0/0)', () => {
  const ds = interpretarDataset(
    arquivo(
      'abc;1;2024-01-01 00:00:00;-10.1;-37.1;false;',
      '1;1;;-10.1;-37.1;false;',
      '2;1;2024-01-01 00:00:00;;-37.1;false;',
      '3;1;2024-01-01 00:00:00;-10.1;xyz;false;',
      '4;1;2024-01-01 00:00:00;95.0;-37.1;false;',
      '5;1;2024-01-01 00:00:00;0;0;false;',
      'idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida',
      '6;1;2024-01-01 00:00:00;-10.1;-37.1;false;',
    ),
  );
  assert.equal(ds.totalPosicoes, 1);
  assert.deepEqual(ds.estatisticas.descartadas, { idInvalido: 2, timestampInvalido: 1, coordenadaInvalida: 4 });
});

test('sem cabeçalho, usa a ordem de colunas do enunciado', () => {
  const ds = interpretarDataset('40;7;2024-01-01 00:01:50;-10.07996;-37.08384;false;\n');
  assert.equal(ds.estatisticas.cabecalho, null);
  assert.equal(ds.totalPosicoes, 1);
  assert.equal(ds.pessoas[0].id, 40);
});

test('com cabeçalho em outra ordem, mapeia as colunas pelo nome', () => {
  const ds = interpretarDataset(
    'timestamp;latitude;longitude;idMonitorado;idsRestricaoMedida;medidaProtetiva;faccaoMonitorado\n' +
      '2024-01-01 00:01:50;-10.07993;-37.08386;90;40;true;\n',
  );
  assert.deepEqual(ds.pessoas[0], { id: 90, faccao: null, vitima: true, restricoes: [40] });
  assert.equal(ds.latitude[0], -10.07993);
});

test('booleanos em vários formatos', () => {
  for (const verdadeiro of ['true', 'TRUE', 'True', '1', 'sim', 'S', 'yes', 'Y', 'verdadeiro', '"true"', ' true ']) {
    assert.equal(lerBooleano(...campo(verdadeiro)), true, verdadeiro);
  }
  for (const falso of ['false', 'FALSE', '0', 'não', 'nao', 'N', 'no', '', '  ', 'falso']) {
    assert.equal(lerBooleano(...campo(falso)), false, falso);
  }
});

test('lista de ids em vários formatos', () => {
  assert.deepEqual(lerListaDeIds(...campo('1,2,3')), [1, 2, 3]);
  assert.deepEqual(lerListaDeIds(...campo('"12,15"')), [12, 15]);
  assert.deepEqual(lerListaDeIds(...campo('[1, 2, 3]')), [1, 2, 3]);
  assert.deepEqual(lerListaDeIds(...campo('1.0,2.0')), [1, 2]);
  assert.deepEqual(lerListaDeIds(...campo('')), []);
});

test('facção: vazio/null/none = sem facção; compara sem diferenciar maiúsculas', () => {
  for (const vazio of ['', ' ', 'null', 'NULL', 'None', 'undefined', 'NaN', '-']) assert.equal(normalizarFaccao(vazio), null);
  assert.equal(normalizarFaccao(' cv '), 'CV');
  assert.equal(normalizarFaccao('7'), '7');
});

test('inteiros: aceita "40", "+40", "40.0"; rejeita "4a", "40.5", vazio', () => {
  assert.equal(lerInteiro(...campo('40')), 40);
  assert.equal(lerInteiro(...campo(' "40" ')), 40);
  assert.equal(lerInteiro(...campo('+40')), 40);
  assert.equal(lerInteiro(...campo('40.0')), 40);
  for (const invalido of ['4a', '40.5', '', 'idMonitorado', '-']) assert.ok(Number.isNaN(lerInteiro(...campo(invalido))), invalido);
});

test('lerDecimal devolve exatamente o mesmo double que Number() (200 mil valores aleatórios)', () => {
  const aleatorio = criarAleatorio(123);
  for (let k = 0; k < 200_000; k++) {
    const casas = Math.floor(aleatorio() * 9);
    const valor = (aleatorio() - 0.5) * 360;
    const texto = valor.toFixed(casas);
    assert.equal(lerDecimal(...campo(texto)), Number(texto), texto);
    assert.equal(lerDecimal(...campo(texto.replace('.', ','))), Number(texto), texto);
  }
  assert.equal(lerDecimal(...campo('1e-3')), 0.001);
  assert.ok(Number.isNaN(lerDecimal(...campo(''))));
  assert.ok(Number.isNaN(lerDecimal(...campo('abc'))));
  assert.ok(Number.isNaN(lerDecimal(...campo('-'))));
});

test('timestamps: agrupa pelo texto exato, inclusive fora do padrão', () => {
  const ds = interpretarDataset(
    arquivo(
      '1;;2024-01-01 00:00:05;-10.1;-37.1;false;',
      '2;;2024-01-01 00:00:05;-10.1;-37.1;false;',
      '3;;2024-01-01T00:00:05;-10.1;-37.1;false;',
      '4;;2024-01-01T00:00:05;-10.1;-37.1;false;',
    ),
  );
  assert.deepEqual(ds.timestamps, ['2024-01-01 00:00:05', '2024-01-01T00:00:05']);
  assert.deepEqual([...ds.timestampDaPosicao.subarray(0, 4)], [0, 0, 1, 1]);
});

test('atributos da pessoa vêm da primeira linha em que ela aparece', () => {
  const ds = interpretarDataset(
    arquivo('90;;2024-01-01 00:00:00;-10.1;-37.1;true;40', '90;;2024-01-01 00:00:05;-10.1;-37.1;true;40'),
  );
  assert.equal(ds.pessoas.length, 1);
  assert.equal(ds.totalPosicoes, 2);
});
