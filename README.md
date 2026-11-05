# Detecção de Encontros · Desafio Trainee Tech Spacecom 2027

Solução em **TypeScript (Node.js)** que processa os dados de geolocalização de monitorados por tornozeleira e de vítimas com medida protetiva e detecta, em cada instante, os **encontros físicos a menos de 20 metros** — classificados como `generico`, `faccao` ou `protetiva`.

> **Em resumo:** o arquivo é lido byte a byte para arrays tipados → as posições são agrupadas por timestamp → em cada timestamp, as pessoas são ordenadas por latitude e só quem está numa janela de 20 m é comparado → Haversine (R = 6.371.000 m) confirma a distância → o par é classificado por prioridade (protetiva > facção > genérico).
> Sem nenhuma dependência em tempo de execução. Resultado conferido contra as respostas oficiais, contra uma implementação de força bruta e por 36 testes automatizados.

## Sumário

1. [Como executar](#1-como-executar)
2. [Resultados](#2-resultados)
3. [Como a solução funciona](#3-como-a-solução-funciona)
4. [Regras de negócio e decisões de interpretação](#4-regras-de-negócio-e-decisões-de-interpretação)
5. [Por que esta é a melhor abordagem](#5-por-que-esta-é-a-melhor-abordagem)
6. [Como sei que está certo](#6-como-sei-que-está-certo)
7. [Estrutura do projeto](#7-estrutura-do-projeto)
8. [Uso de IA](#8-uso-de-ia)
9. [Limitações e próximos passos](#9-limitações-e-próximos-passos)

---

## 1. Como executar

**Pré-requisito:** [Node.js](https://nodejs.org) 20 ou superior (testado no 22 e no 24). Não há dependências de execução — o `npm install` só instala o compilador TypeScript e já compila o projeto para `dist/`.

```bash
npm install
npm run tudo
```

O `npm run tudo` faz o ciclo completo e mostra o resultado de cada etapa:

| # | Etapa | O que acontece |
|---|---|---|
| 1 | Baixar | Baixa os 7 datasets e as 2 respostas de exemplo para `data/` (pula os que já existem) |
| 2 | Diagnóstico | Gera um raio-x da qualidade dos dados em `relatorios/diagnostico.txt` |
| 3 | Processar | Gera `output/dataset1.json` … `output/dataset7.json` |
| 4 | Validar | Compara os datasets 1 e 2 com as respostas oficiais usando o score do desafio |
| 5 | Conferir | Compara cada saída com uma implementação de força bruta (devem ser idênticas) |
| 6 | Testes | Roda os testes automatizados |
| 7 | Benchmark | Mede o tempo médio de execução por dataset |
| 8 | Entrega | Atualiza a seção [Resultados](#2-resultados) deste README e gera o `.zip` em `entrega/` |

Para processar só um arquivo, ou usar os comandos separadamente:

```bash
npm start                                      # processa todos os data/dataset*.txt → output/
npm start -- data/dataset3.txt                 # só um arquivo
node dist/src/cli.js data/dataset3.txt         # direto, sem passar pelo npm
node dist/src/cli.js arquivo.txt --saida pasta # escolhendo a pasta de saída
```

> **Para medir o tempo de execução**, use `node dist/src/cli.js <dataset>` (o código já vem compilado pelo `npm install`; nada é transpilado na hora). A própria saída mostra o tempo do algoritmo por dataset, e `npm run benchmark` calcula a média de várias execuções.

| Comando | O que faz |
|---|---|
| `npm run build` | Compila TypeScript → `dist/` (o `npm install` já faz isso; use depois de alterar o código) |
| `npm run baixar` | Baixa os arquivos do desafio |
| `npm run validar` | Score contra `respostas1.json` e `respostas2.json`, com diagnóstico de cada divergência |
| `npm run conferir` | Saída otimizada × força bruta, dataset por dataset |
| `npm test` | Testes automatizados (`node:test`) |
| `npm run benchmark` | Tempo médio por dataset (`-- --sintetico` inclui um teste de escala com ~1 milhão de linhas) |
| `npm run diagnostico` | Raio-x dos dados: formatos, linhas inválidas, duplicatas, ordenação |
| `npm run empacotar` | Gera o `.zip` de entrega |

Cada `data/<nome>.txt` gera `output/<nome>.json`: um array JSON com um encontro por linha, em ordem cronológica, exatamente na estrutura pedida:

```json
{"tipo":"faccao","monitoradosEncontro":[40,44],"timestamp":"2024-01-01 00:01:50","posicoes":{"40":{"lat":-10.07996,"lon":-37.08384},"44":{"lat":-10.07987,"lon":-37.08389}},"distanciaMetros":11.406788673336607}
```

---

## 2. Resultados

<!-- RESULTADOS:INICIO -->
> Gerado automaticamente por `npm run tudo` em 03/11/2026, 20:39:38 · Node v24.18.0 · AMD Ryzen 7 5800H with Radeon Graphics.

**Validação com as respostas oficiais** — score 10 de 10 possíveis (Score = corretos − falsos positivos):

| Dataset | Esperados | Corretos | Falsos positivos | Não encontrados | Distâncias idênticas | Score |
|---|---:|---:|---:|---:|---:|---:|
| dataset1 | 4 | 4 | 0 | 0 | 4/4 | **4 / 4** |
| dataset2 | 6 | 6 | 0 | 0 | 5/6 | **6 / 6** |

**Encontros detectados e tempo médio de execução (5 execuções):**

| Dataset | Posições | Pessoas | Genérico | Facção | Protetiva | Total | Algoritmo | Processo completo |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| dataset1 | 5.000 | 10 | 2 | 1 | 1 | 4 | 3,91 ms | 700,4 ms |
| dataset2 | 25.000 | 20 | 3 | 2 | 1 | 6 | 11,3 ms | 699,4 ms |
| dataset3 | 100.000 | 40 | 5 | 3 | 2 | 10 | 32,5 ms | 721,5 ms |
| dataset4 | 400.020 | 60 | 7 | 5 | 3 | 15 | 129,6 ms | 854,8 ms |
| dataset5 | 1.000.000 | 80 | 10 | 7 | 4 | 21 | 326,6 ms | 1.043,7 ms |
| dataset6 | 8.000.000 | 100 | 12 | 9 | 6 | 27 | 2.552,6 ms | 3.298,3 ms |
| dataset7 | 12.000.000 | 120 | 15 | 12 | 8 | 35 | 3.944,1 ms | 4.745,1 ms |
| **Soma** | | | | | | | **7.000,6 ms** | **12.063,2 ms** |

"Algoritmo" = leitura + detecção + gravação do JSON. "Processo completo" = `node dist/src/cli.js <dataset>` do zero, incluindo a inicialização do Node.

**Qualidade dos dados:** nenhuma linha inválida ou repetida nos datasets.

**Conferência com a força bruta** — ✅ 5 de 5 datasets com JSON idêntico ao da implementação de referência, que compara todos os pares (`npm run conferir`):

| Dataset | Pares comparados pela força bruta | Força bruta | Otimizado | Mais rápido | Resultado |
|---|---:|---:|---:|---:|---|
| dataset1 | 22.500 | 16,7 ms | 3,91 ms | 4× | ✅ idêntico |
| dataset2 | 237.500 | 54,0 ms | 11,3 ms | 5× | ✅ idêntico |
| dataset3 | 1.950.000 | 290,8 ms | 32,5 ms | 9× | ✅ idêntico |
| dataset4 | 11.800.590 | 1.232,5 ms | 129,6 ms | 10× | ✅ idêntico |
| dataset5 | 39.500.000 | 3.618,4 ms | 326,6 ms | 11× | ✅ idêntico |
| dataset6 | 396.000.000 | — | 2.552,6 ms | — | pulado |
| dataset7 | 714.000.000 | — | 3.944,1 ms | — | pulado |
<!-- RESULTADOS:FIM -->

---

## 3. Como a solução funciona

```
 data/datasetN.txt
        │
        ▼
 ┌─────────────────────────────────┐
 │ 1. Leitura byte a byte          │  pessoa, timestamp, lat, lon → arrays tipados
 └─────────────────────────────────┘
        │
        ▼
 ┌─────────────────────────────────┐
 │ 2. Agrupamento por timestamp    │  counting sort, O(N)
 └─────────────────────────────────┘
        │   para cada timestamp (em ordem cronológica):
        ▼
 ┌─────────────────────────────────┐
 │ 3. Remove posição repetida      │  mesma pessoa duas vezes no mesmo instante
 │ 4. Ordena por latitude          │  sort nativo de Float64Array
 │ 5. Janela de latitude (20 m)    │  só compara quem está na faixa
 │ 6. Filtro de longitude          │  descarta quem está longe na outra direção
 │ 7. Classificação do par         │  protetiva > facção > genérico (ou nenhum)
 │ 8. Haversine < 20 m             │  R = 6.371.000 m
 └─────────────────────────────────┘
        │
        ▼
 output/datasetN.json
```

### 3.1 Leitura — [`src/leitura.ts`](src/leitura.ts)

O arquivo é lido inteiro como bytes e cada campo é interpretado direto do buffer: números são montados dígito a dígito, sem criar uma string por campo (o que, com milhões de linhas, pesaria em memória e em garbage collector). As posições vão para **arrays tipados** (`Int32Array`/`Float64Array`) — a posição `i` é a pessoa `pessoaDaPosicao[i]` no timestamp `timestampDaPosicao[i]`, em (`latitude[i]`, `longitude[i]`).

A conversão de texto para número é **exata**: `-10.07996` vira o inteiro `1007996` dividido por `10^5`. Como os dois são representados sem erro em ponto flutuante e a divisão IEEE-754 é corretamente arredondada, o resultado é bit a bit o mesmo de `Number()` — há um teste que confere isso em 200 mil valores.

A leitura também é tolerante a dados reais "sujos" (detalhes na [seção 4](#4-regras-de-negócio-e-decisões-de-interpretação)): BOM, `\r\n`, espaços, aspas, vírgula decimal, booleanos em vários formatos, colunas em outra ordem e linhas inválidas — que são descartadas e contadas, nunca derrubam o processamento.

**Dois caminhos, mesmo resultado.** Quase todas as linhas são "limpas" e de alguém que já apareceu antes. Para elas existe um *caminho rápido*, que lê id, timestamp e coordenadas numa única passada e nem relê os atributos da pessoa — a leitura fica cerca de 2× mais rápida. Qualquer linha fora desse formato estrito (a primeira de cada pessoa, campos com espaços ou aspas, vírgula decimal, linha inválida…) vai para o *caminho completo*, tolerante. Como o caminho rápido só aceita um subconjunto estrito do formato, os dois produzem exatamente o mesmo resultado — há testes comparando um com o outro.

### 3.2 Agrupamento por timestamp — [`src/detector.ts`](src/detector.ts)

O enunciado manda comparar **apenas posições com o mesmo timestamp**. As posições são agrupadas com um *counting sort*: uma passada para contar quantas há em cada timestamp, outra para colocá-las no lugar. É O(N) e estável (dentro de cada timestamp a ordem do arquivo é mantida). Se uma pessoa aparece duas vezes no mesmo timestamp, vale a primeira linha — assim o mesmo par nunca é registrado em dobro.

### 3.3 Busca de pares próximos: ordenação + janela

Comparar todo mundo com todo mundo custa P·(P−1)/2 pares por timestamp. A otimização vem de uma propriedade simples da geometria:

> Dois pontos a menos de 20 m de distância têm, obrigatoriamente, latitudes a menos de **0,00018°** uma da outra — porque andar pelo meridiano é o caminho mais curto para mudar de latitude, então `distância ≥ R · |Δlatitude|`.

Então, em cada timestamp, as posições são **ordenadas por latitude** e, para cada uma, só olhamos as seguintes **enquanto a latitude estiver dentro da janela**. Quando sai da janela, todas as próximas também estão fora — o laço para ali (técnica de *sweep line*).

```
 latitude ▲
          │        ● C     ← fora da janela de A: a busca para aqui (e tudo acima também)
 ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─   latitude de A + 0,00018°
          │    ● B         ← candidato: passa pelo filtro de longitude e pelo Haversine
          │ ● A
          └──────────────► longitude
```

Na longitude vale o mesmo raciocínio (corrigido pelo cosseno da latitude, porque o grau de longitude "encolhe" longe do equador). Os dois filtros são só comparações de números; o Haversine (com seno, cosseno e raiz) roda apenas para os poucos candidatos que sobram. As janelas têm uma margem de segurança mínima, então **nunca descartam um encontro verdadeiro** — há um teste com 500 mil pares aleatórios em latitudes de −80° a 80° garantindo isso.

Detalhe de desempenho: em vez de `sort()` com função de comparação (que chama JavaScript a cada comparação), cada posição vira um único número — *faixa de latitude × 2²⁴ + índice* — e o `Float64Array` é ordenado pelo sort nativo, cerca de 2,5× mais rápido.

### 3.4 Distância — [`src/geo.ts`](src/geo.ts)

Fórmula de Haversine com o raio exigido (R = 6.371.000 m):

```
a = sin²(Δφ/2) + cos φ₁ · cos φ₂ · sin²(Δλ/2)
d = 2R · atan2(√a, √(1 − a))
```

Ela está escrita na forma clássica, com as diferenças calculadas em graus e depois convertidas para radianos. No exemplo do enunciado (monitorados 40 e 44) reproduz exatamente `11.406788673336607`, bit a bit — outras formas equivalentes no papel diferem na última casa decimal.

### 3.5 Classificação — [`src/regras.ts`](src/regras.ts)

Toda a regra de negócio está num único lugar. Como cada par gera no máximo **um** registro por timestamp, quando um par se encaixa em mais de um tipo vale a prioridade do mais específico para o mais geral:

| Prioridade | Tipo | Quando |
|---|---|---|
| 1 | `protetiva` | Um está na lista `idsRestricaoMedida` do outro (agressor × sua vítima) |
| 2 | `faccao` | Dois monitorados de tornozeleira com a mesma facção (não vazia) |
| 3 | `generico` | Dois monitorados de tornozeleira quaisquer |
| — | nenhum | Vítima perto de quem não é seu agressor, ou vítima perto de vítima |

Os pares com medida protetiva são montados uma única vez num `Set`, então classificar um par custa O(1).

### 3.6 Saída — [`src/saida.ts`](src/saida.ts)

Um encontro por linha, em ordem cronológica e, no mesmo timestamp, pelos ids; `monitoradosEncontro` em ordem crescente (o enunciado diz que a ordem não importa). O texto é gravado em blocos direto no arquivo — memória constante e ~2,5× mais rápido do que montar um texto gigante. Um teste garante que o resultado é idêntico ao `JSON.stringify` dos objetos.

---

## 4. Regras de negócio e decisões de interpretação

| Situação | Decisão | Por quê |
|---|---|---|
| Distância exatamente 20 m | Não é encontro | O enunciado diz "distância **menor** que 20 metros" |
| Timestamps diferentes (mesmo que 5 s) | Nunca são comparados | Regra explícita: só o **exato mesmo** timestamp; a comparação é pelo texto exato |
| Par que se encaixa em mais de um tipo | Um único registro, pela prioridade protetiva > facção > genérico | Regra de unicidade: um registro por par por timestamp |
| Vítima perto de quem não é seu agressor | Não é encontro | Encontros genéricos e de facção são entre monitorados de tornozeleira; a vítima só participa do encontro de medida protetiva |
| Medida protetiva registrada em qualquer um dos dois | `protetiva` | A relação agressor–vítima vale nos dois sentidos |
| Facção vazia, `null`, `none`, `NaN` | Sem facção | Só monitorados com a **mesma** facção preenchida geram encontro de facção; letras maiúsculas/minúsculas não diferenciam |
| Quem é vítima | `medidaProtetiva` verdadeiro ou lista de restrição preenchida | Robusto a booleanos em vários formatos: `true/false`, `1/0`, `sim/não`, `S/N`, `yes/no` |
| Mesma pessoa duas vezes no mesmo timestamp | Vale a primeira linha; as outras são contadas e ignoradas | Evita registrar o mesmo encontro em dobro |
| Atributos da pessoa (facção, medida, restrições) | Lidos da primeira linha em que ela aparece | São da pessoa, não da posição; o diagnóstico aponta se algum dataset tiver inconsistência |
| Linha com id não numérico, timestamp vazio, coordenada inválida/fora da faixa ou (0, 0) | Descartada e contada nas estatísticas | (0, 0) é o clássico "GPS sem sinal"; a linha ruim não contamina o resto |
| Formatos variados nos campos | Aceitos: aspas, espaços, `\r\n`, BOM, vírgula decimal, `"1,2,3"` ou `[1, 2, 3]`, colunas em outra ordem (mapeadas pelo cabeçalho) | Dados de campo raramente vêm perfeitos |

---

## 5. Por que esta é a melhor abordagem

**1. Correção em primeiro lugar.** O score penaliza falso positivo tanto quanto premia acerto, então não basta "parecer certo": a solução é verificada por três caminhos independentes (próxima seção), e as regras ficam concentradas num módulo pequeno e legível.

**2. Complexidade certa para o problema.** Sendo P o número de pessoas num instante e T o número de timestamps:

| Abordagem | Custo | Pares por timestamp com P = 1.000 |
|---|---|---|
| Força bruta (todos com todos) | O(T · P²) | 499.500 cálculos de Haversine |
| Ordenação + janela (esta solução) | O(T · P log P + candidatos) | ~1.000 ordenações + só os vizinhos de latitude |

A diferença cresce com o quadrado de P — os números reais estão na tabela de conferência em [Resultados](#2-resultados).

**3. Desempenho medido, não suposto.** Cada otimização entrou depois de medir com o profiler do Node e foi conferida para não mudar o resultado:

- leitura byte a byte para arrays tipados, sem strings intermediárias, com caminho rápido para linhas limpas (~2× na leitura);
- números gravados direto no array de destino (evita alocar um objeto por número e o garbage collector parou de aparecer no perfil);
- agrupamento O(N) por counting sort;
- ordenação nativa com chave empacotada (~2,5× mais rápida que `sort` com comparador);
- filtros baratos e classificação **antes** do Haversine;
- escrita em blocos (~2,5× mais rápida, memória constante);
- zero dependências e JavaScript compilado — nada de transpilar em tempo de execução.

**4. Alternativas consideradas:**

| Alternativa | Por que não |
|---|---|
| Força bruta O(P²) | Simples, mas quadrática. Foi mantida como **implementação de referência** para conferir a otimizada |
| Grade espacial (hash de células de 20 m) | Também é ~O(N), mas exige uma tabela hash por timestamp e o tratamento das 8 células vizinhas; ordenação + janela é mais simples e tão rápida quanto neste cenário |
| k-d tree, R-tree, quadtree | Ótimas para muitas consultas sobre dados fixos; aqui cada timestamp é um conjunto novo e pequeno, e o custo de construir a árvore não se paga |
| Geohash | Pontos vizinhos podem cair em células diferentes (problema de borda) — teria de consultar vizinhos de qualquer jeito |
| Banco com PostGIS (`ST_DWithin`) | Excelente em produção, mas exige infraestrutura para um processamento em lote, e o desafio pede JS/TS |
| Paralelizar com `worker_threads` | Em datasets deste porte, o custo de criar threads supera o ganho; fica como caminho de escala (seção 9) |

**5. Pronto para dados reais.** Linhas inválidas, duplicadas ou em formatos diferentes são tratadas e contadas, e o `npm run diagnostico` mostra exatamente o que havia em cada arquivo.

---

## 6. Como sei que está certo

| Verificação | O que garante |
|---|---|
| **Respostas oficiais** (`npm run validar`) | Compara com `respostas1.json` e `respostas2.json` usando o score do desafio (corretos − falsos positivos), confere distância e posições de cada encontro e, se houver divergência, explica o motivo provável de cada caso |
| **Força bruta** (`npm run conferir`) | Uma implementação propositalmente simples — `split()`, todos os pares, sem nenhuma otimização — precisa gerar **exatamente o mesmo JSON** em todos os datasets |
| **Testes** (`npm test`) | 36 testes: exemplo do enunciado, cada tipo de encontro, prioridade, limite de 19,9 m × 20,1 m, timestamps diferentes, duplicatas, ordenação, formatos sujos, exatidão da leitura de números, segurança das janelas, caminho rápido ≡ caminho completo da leitura e equivalência com a força bruta em 60 datasets aleatórios (com e sem ruído) |

---

## 7. Estrutura do projeto

```
src/                          ← a solução
  cli.ts                      linha de comando
  processar.ts                ler → detectar → gravar, medindo o tempo de cada etapa
  leitura.ts                  leitura byte a byte, tolerante a dados sujos
  detector.ts                 agrupamento, ordenação + janela, Haversine
  regras.ts                   classificação dos encontros (toda a regra de negócio)
  geo.ts                      Haversine e janelas do pré-filtro
  saida.ts                    JSON no formato do enunciado
  tipos.ts, terminal.ts       tipos compartilhados e formatação do terminal
ferramentas/                  ← apoio (não fazem parte do algoritmo)
  tudo.ts                     pipeline completo (npm run tudo)
  baixar-datasets.ts          download dos arquivos do desafio
  validar.ts                  score contra as respostas oficiais + diagnóstico
  referencia-forca-bruta.ts   implementação de referência (todos os pares)
  conferir.ts                 otimizado × força bruta nos datasets
  diagnostico.ts              raio-x da qualidade dos dados
  benchmark.ts                tempo médio de execução
  gerar-dataset.ts            gerador de datasets sintéticos (testes e escala)
  atualizar-readme.ts         preenche a seção Resultados
  empacotar.ts                gera o .zip de entrega
tests/                        ← testes automatizados (node:test)
output/                       ← JSONs gerados (um por dataset)
```

---

## 8. Uso de IA

O enunciado permite IA e diz que o mais importante é saber o que se está construindo — então deixo claro como usei.

A solução foi construída com o **Claude** (assistente de IA da Anthropic) como par de programação: a partir do enunciado, ele escreveu a maior parte do código, dos testes e desta documentação. As decisões estão explicadas nas seções 3 a 5.

Para o resultado não depender de confiar na IA, a própria solução se verifica:

- a saída é comparada com as **respostas oficiais** usando o mesmo score do desafio;
- uma implementação de **força bruta**, simples o bastante para conferir a olho, precisa gerar exatamente o mesmo resultado que a versão otimizada;
- os **testes** cobrem as regras, os casos de borda e os dados malformados;
- as otimizações só entraram depois de **medir** com profiler, e cada uma foi conferida para não alterar o resultado.

A IA acelerou a escrita; entender e defender a solução nas próximas etapas é responsabilidade minha.

---

## 9. Limitações e próximos passos

- **Memória:** o arquivo é lido inteiro (adequado até alguns GB). Para arquivos maiores, a leitura passaria a ser em streaming — se o arquivo vier ordenado por tempo, dá para processar um timestamp por vez com memória constante.
- **Tempo real:** em produção, o mesmo algoritmo funciona sobre o fluxo de posições: a cada timestamp recebido, detecta os encontros daquele instante e dispara alertas (a medida protetiva com prioridade máxima).
- **Atributos que mudam:** hoje facção e medida protetiva vêm da primeira linha da pessoa. Se puderem mudar ao longo do tempo (por exemplo, uma nova medida concedida), a classificação passaria a usar os atributos de cada linha.
- **Escala:** para volumes muito maiores, dividir os timestamps entre `worker_threads` (os timestamps são independentes entre si) e, para consultas históricas, um índice espacial em banco (PostGIS).
- **Eventos contínuos:** um mesmo par perto em timestamps seguidos poderia ser consolidado num único "evento" com início e fim — útil para o operador, mas fora do formato pedido.

---

Pedro Almeida · [github.com/Pealmeida-byt](https://github.com/Pealmeida-byt)
