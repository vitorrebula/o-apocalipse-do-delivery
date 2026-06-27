/**
 * Script k6 — SMOKE TEST (validação rápida de ponta a ponta)
 *
 * Carga pequena e curta, só para confirmar que servidor + gateway + (Toxiproxy)
 * conversam corretamente antes de rodar a volumetria pesada da Black Friday.
 *
 * Uso:
 *   k6 run load-tests/k6-smoke.js
 *   BASE_URL=http://localhost:3001 k6 run load-tests/k6-smoke.js   # via Toxiproxy
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const erros = new Rate('erros_checkout');

export const options = {
  vus: 5,
  duration: '10s',
  thresholds: {
    http_req_duration: ['p(95)<2500'],
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const headers = { 'Content-Type': 'application/json' };

function payload(vu) {
  return JSON.stringify({
    clienteEmail: `cliente${vu}@smoke.com`,
    valor: 50.0,
    cartao: { numero: '4111111111111111', validade: '12/27', cvv: '123' },
  });
}

export default function () {
  const res = http.post(`${BASE_URL}/api/v1/checkout`, payload(__VU), { headers });

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'tem pedido': (r) => r.body && r.body.includes('Pedido finalizado'),
  });
  erros.add(!ok);

  sleep(0.5);
}
