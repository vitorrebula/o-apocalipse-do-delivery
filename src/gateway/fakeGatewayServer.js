const express = require('express');

/**
 * Gateway de Pagamento FALSO (processo HTTP externo).
 *
 * Simula a API de pagamento parceira como um serviço de rede independente,
 * para que o Toxiproxy possa interceptar a comunicação CheckoutService → Gateway
 * e injetar latência/falhas (Fase 4 — Engenharia do Caos).
 *
 * Configurável por variáveis de ambiente:
 *   GATEWAY_PORT      porta de escuta (default 9000)
 *   GATEWAY_DELAY_MS  latência base da resposta (default 100)
 *   GATEWAY_MODE      'aprovar' (default) | 'recusar' | 'erro'
 */
const app = express();
app.use(express.json());

app.post('/cobrar', (req, res) => {
  const delay = Number(process.env.GATEWAY_DELAY_MS || 100);
  const mode = process.env.GATEWAY_MODE || 'aprovar';

  setTimeout(() => {
    if (mode === 'recusar') {
      return res.json({ status: 'RECUSADO' });
    }
    if (mode === 'erro') {
      return res.status(500).json({ erro: 'Falha interna do gateway de pagamento' });
    }
    return res.json({ status: 'APROVADO' });
  }, delay);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.GATEWAY_PORT || 9000;
app.listen(PORT, () => console.log(`Fake Gateway de Pagamento rodando na porta ${PORT} (modo: ${process.env.GATEWAY_MODE || 'aprovar'})`));
