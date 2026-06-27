const { CheckoutService } = require('../../src/services/CheckoutService');
const { PedidoBuilder } = require('../builders/PedidoBuilder');
const { PedidoMother } = require('../builders/PedidoMother');

// Fábrica de stubs/mocks padrão para isolar dependências
function criarDependencias(overrides = {}) {
  const gatewayStub = {
    cobrar: jest.fn().mockResolvedValue({ status: 'APROVADO' }),
    ...overrides.gateway,
  };
  const repositoryStub = {
    salvar: jest.fn().mockImplementation(async pedido => ({ ...pedido, id: 42 })),
    ...overrides.repository,
  };
  const emailMock = {
    enviarConfirmacao: jest.fn().mockResolvedValue(undefined),
    ...overrides.email,
  };
  return { gatewayStub, repositoryStub, emailMock };
}

describe('CheckoutService', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('Fluxo 1 — Pagamento aprovado (caminho feliz)', () => {
    it('deve retornar pedido com status PROCESSADO quando gateway aprova', async () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock, { maxRetries: 0 });
      const pedido = PedidoMother.pedidoValido();

      const resultado = await service.processar(pedido);

      expect(resultado.status).toBe('PROCESSADO');
    });

    it('deve persistir o pedido aprovado no repositório', async () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock, { maxRetries: 0 });
      const pedido = PedidoMother.pedidoValido();

      await service.processar(pedido);

      expect(repositoryStub.salvar).toHaveBeenCalledWith(expect.objectContaining({ status: 'PROCESSADO' }));
    });

    it('deve disparar e-mail de confirmação quando aprovado (Mock de comportamento)', async () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock, { maxRetries: 0 });
      const pedido = PedidoMother.pedidoValido();

      await service.processar(pedido);

      // Aguarda o fire-and-forget completar
      await new Promise(resolve => setImmediate(resolve));
      expect(emailMock.enviarConfirmacao).toHaveBeenCalledWith(
        pedido.clienteEmail,
        'Pagamento Aprovado'
      );
    });

    it('deve retornar pedido com id gerado pelo repositório', async () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock, { maxRetries: 0 });

      const resultado = await service.processar(PedidoMother.pedidoValido());

      expect(resultado.id).toBe(42);
    });
  });

  describe('Fluxo 2 — Cartão recusado (falha de negócio)', () => {
    it('deve retornar null quando gateway recusa', async () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias({
        gateway: { cobrar: jest.fn().mockResolvedValue({ status: 'RECUSADO' }) },
      });
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock, { maxRetries: 0 });

      const resultado = await service.processar(PedidoMother.pedidoValido());

      expect(resultado).toBeNull();
    });

    it('deve persistir pedido com status FALHOU quando recusado', async () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias({
        gateway: { cobrar: jest.fn().mockResolvedValue({ status: 'RECUSADO' }) },
      });
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock, { maxRetries: 0 });

      await service.processar(PedidoMother.pedidoValido());

      expect(repositoryStub.salvar).toHaveBeenCalledWith(expect.objectContaining({ status: 'FALHOU' }));
    });

    it('NÃO deve disparar e-mail quando cartão é recusado (Mock de comportamento)', async () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias({
        gateway: { cobrar: jest.fn().mockResolvedValue({ status: 'RECUSADO' }) },
      });
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock, { maxRetries: 0 });

      await service.processar(PedidoMother.pedidoValido());

      await new Promise(resolve => setImmediate(resolve));
      expect(emailMock.enviarConfirmacao).not.toHaveBeenCalled();
    });

    it('deve tratar status SALDO_INSUFICIENTE como recusado', async () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias({
        gateway: { cobrar: jest.fn().mockResolvedValue({ status: 'SALDO_INSUFICIENTE' }) },
      });
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock, { maxRetries: 0 });

      const resultado = await service.processar(PedidoMother.pedidoValido());

      expect(resultado).toBeNull();
      expect(repositoryStub.salvar).toHaveBeenCalledWith(expect.objectContaining({ status: 'FALHOU' }));
    });
  });

  describe('Fluxo 3 — Recuperação após retry', () => {
    it('deve processar com sucesso se gateway falha na 1ª tentativa e aprova na 2ª', async () => {
      const cobrarMock = jest.fn()
        .mockRejectedValueOnce(new Error('Conexão recusada'))
        .mockResolvedValue({ status: 'APROVADO' });
      const { repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(
        { cobrar: cobrarMock },
        repositoryStub,
        emailMock,
        { maxRetries: 3, backoffMs: 0 }
      );

      const resultado = await service.processar(PedidoMother.pedidoValido());

      expect(resultado.status).toBe('PROCESSADO');
      expect(cobrarMock).toHaveBeenCalledTimes(2);
    });

    it('deve tentar exatamente maxRetries+1 vezes antes de desistir', async () => {
      const cobrarMock = jest.fn().mockRejectedValue(new Error('Falha persistente'));
      const { repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(
        { cobrar: cobrarMock },
        repositoryStub,
        emailMock,
        { maxRetries: 3, backoffMs: 0 }
      );

      await service.processar(PedidoMother.pedidoValido());

      expect(cobrarMock).toHaveBeenCalledTimes(4); // 1 original + 3 retries
    });
  });

  describe('Fluxo 4 — Falha total de infraestrutura (caos total)', () => {
    it('deve retornar null após esgotar todas as retentativas', async () => {
      const cobrarMock = jest.fn().mockRejectedValue(new Error('Gateway offline'));
      const { repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(
        { cobrar: cobrarMock },
        repositoryStub,
        emailMock,
        { maxRetries: 3, backoffMs: 0 }
      );

      const resultado = await service.processar(PedidoMother.pedidoValido());

      expect(resultado).toBeNull();
    });

    it('deve persistir pedido com status ERRO_GATEWAY após falha total', async () => {
      const cobrarMock = jest.fn().mockRejectedValue(new Error('Gateway offline'));
      const { repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(
        { cobrar: cobrarMock },
        repositoryStub,
        emailMock,
        { maxRetries: 0, backoffMs: 0 }
      );

      await service.processar(PedidoMother.pedidoValido());

      expect(repositoryStub.salvar).toHaveBeenCalledWith(expect.objectContaining({ status: 'ERRO_GATEWAY' }));
    });

    it('NÃO deve disparar e-mail quando há erro de gateway', async () => {
      const cobrarMock = jest.fn().mockRejectedValue(new Error('Timeout'));
      const { repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(
        { cobrar: cobrarMock },
        repositoryStub,
        emailMock,
        { maxRetries: 0, backoffMs: 0 }
      );

      await service.processar(PedidoMother.pedidoValido());

      await new Promise(resolve => setImmediate(resolve));
      expect(emailMock.enviarConfirmacao).not.toHaveBeenCalled();
    });
  });

  describe('Timeout (RN04)', () => {
    it('deve acionar ERRO_GATEWAY quando gateway ultrapassa o timeout configurado', async () => {
      const cobrarLento = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ status: 'APROVADO' }), 500))
      );
      const { repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(
        { cobrar: cobrarLento },
        repositoryStub,
        emailMock,
        { timeoutMs: 50, maxRetries: 0, backoffMs: 0 }
      );

      const resultado = await service.processar(PedidoMother.pedidoValido());

      expect(resultado).toBeNull();
      expect(repositoryStub.salvar).toHaveBeenCalledWith(expect.objectContaining({ status: 'ERRO_GATEWAY' }));
    });
  });

  describe('Circuit Breaker (RF05)', () => {
    it('deve rejeitar imediatamente quando Circuit Breaker está aberto', async () => {
      const { CircuitBreaker } = require('../../src/resilience/CircuitBreaker');
      const cb = new CircuitBreaker({ threshold: 0.5, windowSize: 2 });

      // Força abertura do circuit breaker com falhas
      cb._addResult(false);
      cb._addResult(false);
      cb._recordFailure = jest.fn(() => { cb._state = 'OPEN'; cb._openedAt = Date.now(); });
      cb._state = 'OPEN';
      cb._openedAt = Date.now();

      const cobrarMock = jest.fn().mockResolvedValue({ status: 'APROVADO' });
      const { repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(
        { cobrar: cobrarMock },
        repositoryStub,
        emailMock,
        { maxRetries: 0, circuitBreaker: cb }
      );

      const resultado = await service.processar(PedidoMother.pedidoValido());

      expect(resultado).toBeNull();
      expect(cobrarMock).not.toHaveBeenCalled();
      expect(repositoryStub.salvar).toHaveBeenCalledWith(expect.objectContaining({ status: 'ERRO_GATEWAY' }));
    });
  });

  describe('E-mail fire-and-forget — não bloqueia resposta', () => {
    it('deve retornar o pedido mesmo se o envio de e-mail falhar silenciosamente', async () => {
      const emailFalho = {
        enviarConfirmacao: jest.fn().mockRejectedValue(new Error('SMTP indisponível')),
      };
      const { gatewayStub, repositoryStub } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailFalho, { maxRetries: 0 });

      const resultado = await service.processar(PedidoMother.pedidoValido());

      expect(resultado.status).toBe('PROCESSADO');
    });
  });

  describe('Variações de pedido via PedidoBuilder', () => {
    it('deve processar pedido de alto valor com sucesso', async () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock, { maxRetries: 0 });
      const pedido = PedidoMother.pedidoAltoValor();

      const resultado = await service.processar(pedido);

      expect(resultado.status).toBe('PROCESSADO');
    });

    it('deve repassar valor correto ao gateway', async () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock, { maxRetries: 0 });
      const pedido = new PedidoBuilder().comValor(250.00).build();

      await service.processar(pedido);

      expect(gatewayStub.cobrar).toHaveBeenCalledWith(250.00, pedido.cartao);
    });
  });

  describe('Configuração e valores default', () => {
    it('usa timeout default de 2000ms quando não informado', () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock);
      expect(service.timeoutMs).toBe(2000);
    });

    it('usa maxRetries default de 3 quando não informado', () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock);
      expect(service.maxRetries).toBe(3);
    });

    it('usa backoff default de 500ms quando não informado', () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock);
      expect(service.backoffMs).toBe(500);
    });

    it('respeita timeout customizado', () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock, { timeoutMs: 50 });
      expect(service.timeoutMs).toBe(50);
    });

    it('respeita maxRetries = 0 sem cair no valor default', () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock, { maxRetries: 0 });
      expect(service.maxRetries).toBe(0);
    });

    it('respeita backoff customizado', () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock, { backoffMs: 123 });
      expect(service.backoffMs).toBe(123);
    });

    it('cria um CircuitBreaker default quando não informado', () => {
      const { gatewayStub, repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailMock);
      expect(service.circuitBreaker).toBeDefined();
    });
  });

  describe('Logging de erros', () => {
    it('registra no console a mensagem específica quando o gateway falha', async () => {
      const cobrarMock = jest.fn().mockRejectedValue(new Error('Gateway down'));
      const { repositoryStub, emailMock } = criarDependencias();
      const service = new CheckoutService({ cobrar: cobrarMock }, repositoryStub, emailMock, { maxRetries: 0 });

      await service.processar(PedidoMother.pedidoValido());

      expect(consoleErrorSpy).toHaveBeenCalledWith('Falha catastrófica no gateway bancário:', 'Gateway down');
    });

    it('registra no console a mensagem específica quando o envio de e-mail falha', async () => {
      const emailFalho = { enviarConfirmacao: jest.fn().mockRejectedValue(new Error('SMTP fora')) };
      const { gatewayStub, repositoryStub } = criarDependencias();
      const service = new CheckoutService(gatewayStub, repositoryStub, emailFalho, { maxRetries: 0 });

      await service.processar(PedidoMother.pedidoValido());
      await new Promise(resolve => setImmediate(resolve));

      expect(consoleErrorSpy).toHaveBeenCalledWith('Falha ao enviar e-mail:', 'SMTP fora');
    });
  });
});
