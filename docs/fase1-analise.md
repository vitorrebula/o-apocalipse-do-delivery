# Fase 1 — Análise Estrutural, Complexidade e Métricas de Estimativa

**Componente:** `CheckoutService.processar(pedido)` (código legado)
**Organização:** EntregasJá S.A.
**Versão Analisada:** Legado (pré-refatoração)

---

## 1. Mapeamento de Fluxo — Grafo de Fluxo de Controle

### Descrição dos Nós

| Nó | Tipo | Descrição |
|----|------|-----------|
| N1 | ENTRY | Entrada do método `processar(pedido)` |
| N2 | PROCESSO | Chamada `this.gatewayPagamento.cobrar(pedido.valor, pedido.cartao)` |
| N3 | DECISÃO | `if (resposta.status === 'APROVADO')` |
| N4 | PROCESSO | Caminho feliz: `pedido.status = 'PROCESSADO'` → `salvar()` → `enviarConfirmacao()` |
| N5 | PROCESSO | Caminho recusado: `pedido.status = 'FALHOU'` → `salvar()` |
| N6 | PROCESSO | Bloco catch: `pedido.status = 'ERRO_GATEWAY'` → `salvar()` |
| N7 | EXIT | Retorno/saída do método |

### Representação do Grafo (ASCII)

```
        [N1] ENTRY
          |
          ↓
        [N2] cobrar() ←────────────────── exceção ──────────────┐
          |                                                       |
          ↓ (resolve)                                          [N6] catch
        [N3] status === 'APROVADO'?                              |
         /            \                                          ↓
     Sim               Não                                    [N7] EXIT
      ↓                 ↓
    [N4]              [N5]
  PROCESSADO         FALHOU
    + email           |
      |               ↓
      └──────────→ [N7] EXIT
```

### Arestas do Grafo

| Aresta | De | Para | Condição |
|--------|-----|------|----------|
| E1 | N1 | N2 | sempre |
| E2 | N2 | N3 | try não lança exceção |
| E3 | N2 | N6 | exceção lançada (catch) |
| E4 | N3 | N4 | `status === 'APROVADO'` (true) |
| E5 | N3 | N5 | `status !== 'APROVADO'` (false) |
| E6 | N4 | N7 | return pedidoSalvo |
| E7 | N5 | N7 | return null |
| E8 | N6 | N7 | return null |

**Total:** 7 Nós (N), 8 Arestas (E), 1 Componente Conexo (P)

---

## 2. Cálculo da Complexidade Ciclomática V(G)

### Fórmula Utilizada
```
V(G) = E − N + 2P
```

### Aplicação
```
V(G) = 8 − 7 + 2×1
V(G) = 8 − 7 + 2
V(G) = 3
```

### Validação Alternativa (contagem de decisões)
```
V(G) = Número de pontos de decisão + 1
     = 2 + 1  (1 if/else + 1 try/catch)
     = 3  ✓
```

### Resultado
> **V(G) = 3** — O componente possui **3 caminhos independentes** que precisam, no mínimo, ser cobertos pelos testes.

---

## 3. Caminhos Independentes (Base Path Testing)

| Caminho | Percurso no Grafo | Condição | Mapeamento no Spec |
|---------|-------------------|----------|--------------------|
| **C1** | N1→N2→N3→N4→N7 | Gateway responde `APROVADO` | Fluxo 1 (base) |
| **C2** | N1→N2→N3→N5→N7 | Gateway responde `RECUSADO`/outro | Fluxo 2 (negócio) |
| **C3** | N1→N2→N6→N7 | Gateway lança exceção (timeout, rede) | Fluxo 4 (caos total) |

> **Nota:** O Fluxo 3 (retry com recuperação) é um caminho composto que percorre C3 nas primeiras tentativas e C1 na tentativa bem-sucedida. O Fluxo 5 (dados inválidos) é tratado na camada de controle (server.js), antes de invocar `processar()`.

---

## 4. Métricas e Estimativas de Esforço de Teste

### 4.1 Inventário de Casos de Teste por Técnica

#### Teste de Caixa Branca (Base Path + Critério MC/DC)

| ID | Caminho | Condição de Entrada | Status Esperado | HTTP |
|----|---------|---------------------|-----------------|------|
| TC-01 | C1 | Dados válidos + Gateway APROVADO | PROCESSADO | 200 |
| TC-02 | C2 | Dados válidos + Gateway RECUSADO | FALHOU | 500 |
| TC-03 | C3 | Dados válidos + Gateway lança exceção | ERRO_GATEWAY | 500 |

#### Teste de Caixa Preta (Baseado em Requisitos)

| ID | RF | Condição de Entrada | Comportamento Esperado |
|----|-----|---------------------|------------------------|
| TC-04 | RF01 | Email ausente | 400 — sem acesso a DB/Gateway |
| TC-05 | RF01 | Email inválido (sem @) | 400 |
| TC-06 | RF01 | Valor = 0 | 400 |
| TC-07 | RF01 | Valor negativo | 400 |
| TC-08 | RF01 | Cartão sem CVV | 400 |
| TC-09 | RF01 | Cartão ausente (null) | 400 |
| TC-10 | RF02 | APROVADO → e-mail disparado | emailService.enviarConfirmacao chamado |
| TC-11 | RF03 | RECUSADO → e-mail NÃO disparado | emailService.enviarConfirmacao NÃO chamado |
| TC-12 | RN04 | Gateway demora > 2000ms | Timeout → ERRO_GATEWAY |
| TC-13 | RN05 | Falha na 1ª tentativa, sucesso na 2ª | PROCESSADO após 1 retry |
| TC-14 | RN05 | Falha nas 4 tentativas | ERRO_GATEWAY após esgotar retries |
| TC-15 | RF05 | Circuit Breaker OPEN | Rejeição imediata sem chamar gateway |
| TC-16 | RF02 | E-mail falha silenciosamente | Pedido retornado com sucesso (fire-and-forget) |

**Total de Casos de Teste Identificados: 16**

### 4.2 Pontos de Caso de Teste (PCT) — Adaptação da Técnica AFP

| Componente | Complexidade | Peso | Qtd | PCT |
|------------|-------------|------|-----|-----|
| CheckoutService.processar() | Alta | 3 | 1 | 3 |
| PedidoValidator.validar() | Média | 2 | 1 | 2 |
| withRetry() | Média | 2 | 1 | 2 |
| withTimeout() | Baixa | 1 | 1 | 1 |
| CircuitBreaker | Alta | 3 | 1 | 3 |
| Integração HTTP (server.js) | Média | 2 | 2 endpoints | 4 |
| **Total** | | | | **15 PCT** |

### 4.3 Estimativa de Esforço

#### Premissas
- **Produtividade média:** 2 casos de teste por hora (inclui escrita, execução e documentação)
- **Overhead de setup:** 20% (configuração de ambiente, mocks, stubs)
- **Overhead de revisão:** 10% (peer review e ajustes)
- **Número de desenvolvedores:** 2 (Vitor Rebula Nogueira e Thales Mattos)

#### Cálculo

| Fase | Atividade | Horas Estimadas |
|------|-----------|-----------------|
| Análise | Leitura do código legado e documentação | 2h |
| Fase 1 | Grafo de fluxo + cálculo V(G) + documento | 3h |
| Fase 2 | Setup (Jest, Cucumber, package.json) | 2h |
| Fase 2 | Escrita de 16 casos de teste unitários | 8h |
| Fase 2 | Escrita de 8 cenários Gherkin + steps | 4h |
| Fase 2 | Refatoração do código (TDD) | 6h |
| Fase 3 | Configuração Stryker + análise mutantes | 3h |
| Fase 3 | Enriquecimento da suíte (kill mutants) | 2h |
| Fase 4 | Script k6 + configuração Toxiproxy | 3h |
| Fase 4 | Execução dos experimentos de caos | 2h |
| Fase 4 | Análise de resultados + relatório | 2h |
| **Total** | | **37 horas** |

#### Overhead aplicado
```
Esforço base:         37h
Overhead setup (20%): +7,4h
Overhead revisão (10%): +3,7h
─────────────────────────
Total estimado:       ~48 horas/homem
```

> Com **2 desenvolvedores** atuando em paralelo, o esforço de ~48 h/homem se traduz em um
> **prazo de ~24 horas** por pessoa (≈ 3 dias úteis), dividindo as frentes entre testes/refatoração
> (Fases 2–3) e infraestrutura de caos (Fase 4).

### 4.4 Resumo Executivo

| Métrica | Valor |
|---------|-------|
| Complexidade Ciclomática V(G) | **3** |
| Caminhos independentes mínimos | **3** |
| Total de casos de teste planejados | **16** |
| Pontos de Caso de Teste (PCT) | **15** |
| Esforço total estimado | **~48 h/homem** |
| Mutation Score alvo | **≥ 80%** |
| SLO de latência (p95) | **< 2500ms** |
| SLO de taxa de erro | **< 5%** |

---

## 5. Identificação de Test Smells no Código Legado

| Test Smell | Localização | Refatoração Aplicada |
|------------|-------------|---------------------|
| **Obscure Setup** | `server.js` — mocks embutidos inline na definição do módulo | Injeção de dependência no `CheckoutService`; builders `PedidoBuilder`/`PedidoMother` |
| **Magic String** | `resposta.status === 'APROVADO'` hardcoded | Mapa de handlers por status (Replace Conditional with Polymorphism) |
| **Long Method** | `processar()` com múltiplas responsabilidades | Extract Method: `_handleAprovado()`, `_handleRecusado()`, `_handleErroGateway()` |
| **Coupled Test** | E-mail `await`-ado dentro do fluxo principal | Fire-and-forget via `.catch()` sem await (RF02) |
| **Missing Assertions** | Código original sem nenhum teste | Suite completa com 16+ casos unitários |
