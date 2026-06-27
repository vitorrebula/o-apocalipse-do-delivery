const express = require('express');
const { CheckoutService } = require('./services/CheckoutService');
const { PedidoValidator } = require('./validators/PedidoValidator');
const { CircuitBreaker } = require('./resilience/CircuitBreaker');

const app = express();
app.use(express.json());

// Parâmetros de resiliência configuráveis por ambiente (úteis nos testes de caos)
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:9000';
const TIMEOUT_MS = Number(process.env.CHECKOUT_TIMEOUT_MS || 2000);
const MAX_RETRIES = Number(process.env.CHECKOUT_MAX_RETRIES ?? 3);
const BACKOFF_MS = Number(process.env.CHECKOUT_BACKOFF_MS ?? 500);
const CB_RESET_MS = Number(process.env.CHECKOUT_CB_RESET_MS || 30000);

// Adaptador HTTP do gateway de pagamento externo.
// A chamada de REDE real permite que o Toxiproxy intercepte e injete caos.
// AbortSignal.timeout garante que o socket não fique pendurado (evita exaustão).
const gatewayPagamentoHttp = {
  cobrar: async (valor, cartao) => {
    const resp = await fetch(`${GATEWAY_URL}/cobrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor, cartao }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) {
      throw new Error(`Gateway respondeu HTTP ${resp.status}`);
    }
    return resp.json();
  },
};

const pedidoRepositoryMock = {
  salvar: async (pedido) => ({ ...pedido, id: Math.floor(Math.random() * 10000) }),
};

const emailServiceMock = {
  enviarConfirmacao: async (email, msg) =>
    console.log(`E-mail enviado para ${email}: ${msg}`),
};

const checkoutService = new CheckoutService(
  gatewayPagamentoHttp,
  pedidoRepositoryMock,
  emailServiceMock,
  {
    timeoutMs: TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
    backoffMs: BACKOFF_MS,
    circuitBreaker: new CircuitBreaker({ resetTimeoutMs: CB_RESET_MS }),
  }
);

// ENDPOINT CRÍTICO: receberá carga massiva da Black Friday
app.post('/api/v1/checkout', async (req, res) => {
  const { clienteEmail, valor, cartao } = req.body;
  const pedido = { clienteEmail, valor, cartao, status: 'PENDENTE' };

  const erros = PedidoValidator.validar(pedido);
  if (erros.length > 0) {
    return res.status(400).json({ erro: 'Dados inválidos para checkout', detalhes: erros });
  }

  const resultado = await checkoutService.processar(pedido);

  if (resultado && resultado.status === 'PROCESSADO') {
    return res.status(200).json({ mensagem: 'Pedido finalizado com sucesso!', pedido: resultado });
  }

  return res.status(500).json({ erro: 'Não foi possível processar seu pagamento. Tente mais tarde.' });
});

// Endpoint auxiliar para o cenário Thundering Herd (simula flush de cache)
app.post('/api/v1/cache/flush', (req, res) => {
  console.log('CACHE LIMPO ABRUPTAMENTE!');
  res.json({ status: 'cache_invalidated' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor da EntregasJá rodando na porta ${PORT}`));

module.exports = { app };
