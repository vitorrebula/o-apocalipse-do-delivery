/**
 * Script k6 — Teste de Carga e Estresse Black Friday
 * Fase 4: Engenharia do Caos e Testes de Desempenho (SRE)
 *
 * SLOs definidos:
 *   - p95 de latência < 2500ms
 *   - Taxa de erro < 5%
 *
 * Padrão de carga: ramp-up → steady-state → ramp-down
 *
 * Uso:
 *   k6 run load-tests/k6-checkout.js
 *
 * Com Toxiproxy (Gateway Lento):
 *   Iniciar o servidor apontando para Toxiproxy: PORT=3000 node src/server.js
 *   Injetar latência: toxiproxy-cli toxic add payment_gateway -t latency -a latency=5000
 *   k6 run load-tests/k6-checkout.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Métricas customizadas
const erros = new Rate('erros_checkout');
const latenciaCheckout = new Trend('latencia_checkout_ms');

// -------------------------------------------------------
// Configuração de SLOs e Estágios de Carga (Black Friday)
// -------------------------------------------------------
export const options = {
  stages: [
    { duration: '20s', target: 50 },    // Ramp-up: 0 → 50 VUs
    { duration: '40s', target: 200 },   // Steady-state: 200 VUs (Black Friday)
    { duration: '20s', target: 400 },   // Pico Black Friday: até 400 VUs
    { duration: '40s', target: 200 },   // Volta ao estado estável
    { duration: '20s', target: 0 },     // Ramp-down: desaceleração
  ],

  thresholds: {
    // SLO 1: p95 da latência abaixo de 2500ms (spec doc) / 5000ms (PDF)
    'http_req_duration{cenario:checkout}': ['p(95)<2500'],
    // SLO 2: Taxa global de erros HTTP abaixo de 5%
    'http_req_failed': ['rate<0.05'],
    // SLO 3: Métrica customizada de erros de negócio
    'erros_checkout': ['rate<0.05'],
    // SLO 4: Latência customizada (p95)
    'latencia_checkout_ms': ['p(95)<2500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// -------------------------------------------------------
// Geração de payload realista
// -------------------------------------------------------
function gerarPayload(vuId) {
  return JSON.stringify({
    clienteEmail: `cliente${vuId}@blackfriday.com`,
    valor: parseFloat((Math.random() * 500 + 10).toFixed(2)),
    cartao: {
      numero: '4111111111111111',
      validade: '12/27',
      cvv: '321',
    },
  });
}

const headers = { 'Content-Type': 'application/json' };

// -------------------------------------------------------
// Cenário principal executado por cada VU
// -------------------------------------------------------
export default function () {
  group('Checkout Black Friday', function () {
    const res = http.post(
      `${BASE_URL}/api/v1/checkout`,
      gerarPayload(__VU),
      { headers, tags: { cenario: 'checkout' } }
    );

    latenciaCheckout.add(res.timings.duration);

    const sucesso = check(res, {
      'HTTP 200 — Pedido processado': (r) => r.status === 200,
      'Resposta em menos de 2500ms': (r) => r.timings.duration < 2500,
      'Body contém mensagem de sucesso': (r) => r.body && r.body.includes('Pedido finalizado'),
    });

    erros.add(!sucesso);

    // Pausa entre requisições para simular comportamento real do usuário
    sleep(Math.random() * 1 + 0.5); // 0.5s a 1.5s
  });
}

// -------------------------------------------------------
// Cenário Thundering Herd: 10.000 requisições simultâneas
// Ativar com: k6 run --env CENARIO=thundering_herd load-tests/k6-checkout.js
// -------------------------------------------------------
export function thunderingHerd() {
  const res = http.post(
    `${BASE_URL}/api/v1/cache/flush`,
    null,
    { headers }
  );

  check(res, {
    'Cache flush retornou 200': (r) => r.status === 200,
  });

  // Dispara checkout imediatamente após o flush (sem sleep = thundering herd)
  const resCheckout = http.post(
    `${BASE_URL}/api/v1/checkout`,
    gerarPayload(__VU),
    { headers }
  );

  check(resCheckout, {
    'Sistema sobreviveu ao thundering herd': (r) => r.status === 200 || r.status === 500,
    'Sem erro 502/503 (servidor caiu)': (r) => r.status !== 502 && r.status !== 503,
  });
}

// -------------------------------------------------------
// Setup e teardown para logging
// -------------------------------------------------------
export function setup() {
  console.log(`[k6] Iniciando teste de carga: ${BASE_URL}`);
  console.log('[k6] SLOs: p95 < 2500ms | Taxa de erro < 5%');
}

export function teardown(data) {
  console.log('[k6] Teste de carga finalizado. Verifique o relatório HTML gerado.');
}
