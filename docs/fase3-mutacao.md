# Fase 3 — Relatório de Teste de Mutação (Stryker.js)

**Ferramenta:** Stryker Mutator (`@stryker-mutator/core` + `jest-runner`)
**Runner de testes:** Jest
**Comando:** `npm run stryker`
**Relatório HTML:** [reports/mutation/mutation.html](../reports/mutation/mutation.html)

---

## 1. Objetivo

Provar a **eficácia** da suíte de testes — não basta cobertura de linhas. O teste de mutação injeta defeitos artificiais ("mutantes") no código de produção e verifica se a suíte os detecta (mata). A meta obrigatória do TP é **≥ 80%**; a rubrica de avaliação exige **≥ 90%**.

---

## 2. Resultado Final

| Métrica | Valor |
| :--- | :--- |
| **Mutation Score** | **100,00%** |
| Mutantes mortos (Killed) | 180 |
| Mortos por Timeout | 3 |
| **Sobreviventes (Survived)** | **0** |
| Sem cobertura (No coverage) | 0 |
| Runtime errors* | 2 |
| Cobertura de linhas (Jest) | 100% stmts / 90,9% branches |
| Testes unitários | 83 (em 5 suítes) |

\* *Os 2 "errors" são mutantes em `withTimeout.js` que provocaram erro de runtime irrecuperável (não falha de asserção). O Stryker os trata como **detectados**, portanto não contam como sobreviventes nem reduzem o score.*

---

## 3. Evolução: da Primeira Rodada ao Score Final

A primeira execução do Stryker resultou em **79,26%** (146 killed + 3 timeout, **39 sobreviventes**) — **abaixo do mínimo**. A análise dos sobreviventes guiou o enriquecimento cirúrgico da suíte.

| Rodada | Killed | Timeout | Survived | Score |
| :--- | :---: | :---: | :---: | :---: |
| 1ª (inicial) | 146 | 3 | 39 | 79,26% |
| 2ª (final) | 180 | 3 | **0** | **100,00%** |

---

## 4. Análise dos 39 Mutantes Sobreviventes e Como Foram Mortos

Os sobreviventes se concentraram em 4 categorias. Para cada uma, a técnica de teste aplicada:

### 4.1 Boundary de laço/retry (`withRetry.js`)
- **Mutantes:** `attempt < maxRetries` → `<=`, `>=`; `ConditionalExpression` true/false; remoção do bloco de `_sleep`.
- **Causa da sobrevivência:** os testes originais exercitavam o retry apenas via `CheckoutService` (integração), sem assertar o número exato de esperas.
- **Solução:** novo arquivo [tests/unit/withRetry.test.js](../tests/unit/withRetry.test.js) com espionagem de `setTimeout` (marcador de backoff = 7ms) que conta **exatamente** quantas vezes o sistema dorme. Com `maxRetries=2`, o sistema deve dormir **exatamente 2 vezes** (nunca após a última tentativa) — isso mata todos os mutantes de boundary de uma vez.

### 4.2 Valores default e configuração (`CircuitBreaker.js`, `CheckoutService.js`)
- **Mutantes:** `options.threshold || 0.5` → `&&`; `Math.ceil(windowSize / 2)` → `*`; `options.maxRetries !== undefined ? ...` etc.
- **Causa:** nenhum teste verificava os valores default quando as opções eram omitidas.
- **Solução:** testes de configuração que constroem o objeto **sem** opções e asseram as propriedades públicas (`service.timeoutMs === 2000`, `cb.minRequests === 5`). O teste de `maxRetries: 0` é crucial — `0` é *falsy*, mas o operador `!== undefined` deve preservá-lo (mata o mutante que troca `?:` por `||`).

### 4.3 Boundaries de threshold e reset (`CircuitBreaker.js`)
- **Mutantes:** `errorRate > threshold` → `>=`; `length < minRequests` → `<=`; `Date.now() - openedAt >= resetTimeoutMs` → `>`.
- **Solução:** testes nos pontos exatos de fronteira. Para o reset, `jest.spyOn(Date, 'now')` fixa o tempo decorrido **exatamente** em `resetTimeoutMs` (transiciona) e em `resetTimeoutMs - 1` (permanece OPEN). Para o threshold, o cenário 1-sucesso-depois-1-falha produz `errorRate === 0.5 === threshold`, provando que a abertura é **estritamente maior** (`>`, não `>=`).

### 4.4 Mensagens, logs e efeitos colaterais (Strings e Arrow Functions)
- **Mutantes:** literais de string `→ ""`, e callbacks `→ () => undefined` (ex.: o `.catch()` do e-mail fire-and-forget e o `.finally(clearTimeout)`).
- **Solução:** `jest.spyOn(console, 'error')` assere a **mensagem exata** logada em cada caminho de falha; `jest.spyOn(global, 'clearTimeout')` prova que o timer é liberado quando a promise resolve antes do timeout.

---

## 5. Mutante Equivalente Identificado e Eliminado por Refatoração

Durante a análise, a condição de validação de `valor` no `PedidoValidator` continha:

```js
if (pedido.valor === undefined || pedido.valor === null || pedido.valor <= 0)
```

A cláusula `=== null` era **redundante** (gerando um mutante equivalente): em JavaScript, `null <= 0` coage `null → 0`, resultando em `true`. Logo, qualquer `valor === null` já era capturado pela cláusula `<= 0`, e remover `=== null` (mutação) **não alterava o comportamento** — um mutante impossível de matar por testes.

**Em vez de apenas documentar o equivalente**, refatoramos para uma checagem mais robusta e aderente ao RN01 ("valor numérico estritamente maior que zero"):

```js
if (typeof pedido.valor !== 'number' || pedido.valor <= 0)
```

Isso eliminou a redundância, passou a rejeitar entradas não-numéricas (ex.: `"100"`), e tornou **todos** os mutantes da linha mortais — contribuindo para o score de 100%.

---

## 6. Como Reproduzir

```bash
npm install
npm test            # 83 testes devem passar
npm run stryker     # gera reports/mutation/mutation.html
```

A configuração está em [stryker.config.json](../stryker.config.json), com `break: 80` (falha o build abaixo de 80%) e alvo `high: 90`.
