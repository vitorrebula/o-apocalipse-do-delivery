const { withTimeout } = require('../resilience/withTimeout');
const { withRetry } = require('../resilience/withRetry');
const { CircuitBreaker } = require('../resilience/CircuitBreaker');

const GATEWAY_TIMEOUT_MS = 2000;
const MAX_RETRIES = 3;
const BACKOFF_MS = 500;

class CheckoutService {
  constructor(gatewayPagamento, pedidoRepository, emailService, options = {}) {
    this.gatewayPagamento = gatewayPagamento;
    this.pedidoRepository = pedidoRepository;
    this.emailService = emailService;
    this.timeoutMs = options.timeoutMs || GATEWAY_TIMEOUT_MS;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : MAX_RETRIES;
    this.backoffMs = options.backoffMs !== undefined ? options.backoffMs : BACKOFF_MS;
    this.circuitBreaker = options.circuitBreaker || new CircuitBreaker();
  }

  async processar(pedido) {
    try {
      const cobrar = () =>
        withTimeout(
          this.gatewayPagamento.cobrar(pedido.valor, pedido.cartao),
          this.timeoutMs
        );

      const resposta = await this.circuitBreaker.execute(() =>
        withRetry(cobrar, this.maxRetries, this.backoffMs)
      );

      return await this._handleResposta(pedido, resposta);
    } catch (error) {
      return await this._handleErroGateway(pedido, error);
    }
  }

  // Extract Method: handlers mapeados por status (Replace Conditional with Polymorphism)
  async _handleResposta(pedido, resposta) {
    const handlers = {
      APROVADO: () => this._handleAprovado(pedido),
    };

    const handler = handlers[resposta.status] || (() => this._handleRecusado(pedido));
    return handler();
  }

  async _handleAprovado(pedido) {
    pedido.status = 'PROCESSADO';
    const pedidoSalvo = await this.pedidoRepository.salvar(pedido);

    // RF02: fire-and-forget — e-mail NÃO bloqueia a resposta HTTP
    this.emailService
      .enviarConfirmacao(pedido.clienteEmail, 'Pagamento Aprovado')
      .catch(err => console.error('Falha ao enviar e-mail:', err.message));

    return pedidoSalvo;
  }

  async _handleRecusado(pedido) {
    pedido.status = 'FALHOU';
    await this.pedidoRepository.salvar(pedido);
    return null;
  }

  async _handleErroGateway(pedido, error) {
    console.error('Falha catastrófica no gateway bancário:', error.message);
    pedido.status = 'ERRO_GATEWAY';
    await this.pedidoRepository.salvar(pedido);
    return null;
  }
}

module.exports = { CheckoutService };
