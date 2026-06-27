const { PedidoValidator } = require('../../src/validators/PedidoValidator');
const { PedidoMother } = require('../builders/PedidoMother');
const { PedidoBuilder } = require('../builders/PedidoBuilder');

describe('PedidoValidator', () => {
  describe('Pedido válido', () => {
    it('não deve retornar erros para um pedido completo e válido', () => {
      const erros = PedidoValidator.validar(PedidoMother.pedidoValido());
      expect(erros).toHaveLength(0);
    });
  });

  describe('Validação de clienteEmail (RN01)', () => {
    it('deve retornar erro quando email está ausente', () => {
      const erros = PedidoValidator.validar(PedidoMother.pedidoSemEmail());
      expect(erros).toContain('clienteEmail inválido ou ausente');
    });

    it('deve retornar erro quando email não tem @', () => {
      const erros = PedidoValidator.validar(PedidoMother.pedidoEmailInvalido());
      expect(erros).toContain('clienteEmail inválido ou ausente');
    });

    it('deve retornar erro quando email é string vazia', () => {
      const pedido = new PedidoBuilder().comEmail('').build();
      const erros = PedidoValidator.validar(pedido);
      expect(erros).toContain('clienteEmail inválido ou ausente');
    });

    it('deve aceitar email com subdomínio', () => {
      const pedido = new PedidoBuilder().comEmail('user@mail.entregasja.com').build();
      const erros = PedidoValidator.validar(pedido);
      expect(erros).not.toContain('clienteEmail inválido ou ausente');
    });

    it('deve rejeitar email com texto extra após o domínio (âncora final $)', () => {
      const pedido = new PedidoBuilder().comEmail('user@dominio.com hacker').build();
      const erros = PedidoValidator.validar(pedido);
      expect(erros).toContain('clienteEmail inválido ou ausente');
    });

    it('deve rejeitar email com texto antes do endereço (âncora inicial ^)', () => {
      const pedido = new PedidoBuilder().comEmail('hacker user@dominio.com').build();
      const erros = PedidoValidator.validar(pedido);
      expect(erros).toContain('clienteEmail inválido ou ausente');
    });

    it('deve rejeitar email sem ponto no domínio', () => {
      const pedido = new PedidoBuilder().comEmail('user@dominio').build();
      const erros = PedidoValidator.validar(pedido);
      expect(erros).toContain('clienteEmail inválido ou ausente');
    });
  });

  describe('Validação de valor (RN01)', () => {
    it('deve retornar erro quando valor é zero', () => {
      const erros = PedidoValidator.validar(PedidoMother.pedidoComValorZero());
      expect(erros).toContain('valor deve ser um número maior que zero');
    });

    it('deve retornar erro quando valor é negativo', () => {
      const erros = PedidoValidator.validar(PedidoMother.pedidoComValorNegativo());
      expect(erros).toContain('valor deve ser um número maior que zero');
    });

    it('deve retornar erro quando valor é null', () => {
      const pedido = new PedidoBuilder().comValor(null).build();
      const erros = PedidoValidator.validar(pedido);
      expect(erros).toContain('valor deve ser um número maior que zero');
    });

    it('deve retornar erro quando valor é undefined', () => {
      const pedido = new PedidoBuilder().comValor(undefined).build();
      const erros = PedidoValidator.validar(pedido);
      expect(erros).toContain('valor deve ser um número maior que zero');
    });

    it('deve retornar erro quando valor não é um número (string)', () => {
      const pedido = new PedidoBuilder().comValor('100').build();
      const erros = PedidoValidator.validar(pedido);
      expect(erros).toContain('valor deve ser um número maior que zero');
    });

    it('deve aceitar valor positivo', () => {
      const pedido = new PedidoBuilder().comValor(0.01).build();
      const erros = PedidoValidator.validar(pedido);
      expect(erros).not.toContain('valor deve ser um número maior que zero');
    });

    it('deve aceitar valor numérico alto', () => {
      const pedido = new PedidoBuilder().comValor(9999.99).build();
      const erros = PedidoValidator.validar(pedido);
      expect(erros).not.toContain('valor deve ser um número maior que zero');
    });
  });

  describe('Validação de cartao (RN01)', () => {
    it('deve retornar erro quando cartão é null', () => {
      const erros = PedidoValidator.validar(PedidoMother.pedidoSemCartao());
      expect(erros).toContain('cartao deve conter numero, validade e cvv');
    });

    it('deve retornar erro quando cartão não tem CVV', () => {
      const erros = PedidoValidator.validar(PedidoMother.pedidoCartaoSemCvv());
      expect(erros).toContain('cartao deve conter numero, validade e cvv');
    });

    it('deve retornar erro quando cartão não tem número', () => {
      const pedido = new PedidoBuilder().comCartao({ validade: '12/27', cvv: '123' }).build();
      const erros = PedidoValidator.validar(pedido);
      expect(erros).toContain('cartao deve conter numero, validade e cvv');
    });

    it('deve retornar erro quando cartão não tem validade', () => {
      const pedido = new PedidoBuilder().comCartao({ numero: '4111111111111111', cvv: '123' }).build();
      const erros = PedidoValidator.validar(pedido);
      expect(erros).toContain('cartao deve conter numero, validade e cvv');
    });

    it('deve aceitar cartão com todos os campos', () => {
      const pedido = new PedidoBuilder()
        .comCartao({ numero: '5500005555555559', validade: '06/28', cvv: '999' })
        .build();
      const erros = PedidoValidator.validar(pedido);
      expect(erros).not.toContain('cartao deve conter numero, validade e cvv');
    });
  });

  describe('Múltiplos erros simultâneos', () => {
    it('deve acumular todos os erros de validação', () => {
      const pedido = { clienteEmail: null, valor: -1, cartao: null, status: 'PENDENTE' };
      const erros = PedidoValidator.validar(pedido);
      expect(erros).toHaveLength(3);
    });
  });
});
