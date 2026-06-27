/**
 * Padrão Data Builder — constrói pedidos de forma fluente e modular.
 * Elimina o Test Smell "Obscure Setup" nos testes.
 */
class PedidoBuilder {
  constructor() {
    this._clienteEmail = 'cliente@entregasja.com';
    this._valor = 99.90;
    this._cartao = { numero: '4111111111111111', validade: '12/27', cvv: '123' };
    this._status = 'PENDENTE';
  }

  comEmail(email) {
    this._clienteEmail = email;
    return this;
  }

  comValor(valor) {
    this._valor = valor;
    return this;
  }

  comCartao(cartao) {
    this._cartao = cartao;
    return this;
  }

  comStatus(status) {
    this._status = status;
    return this;
  }

  build() {
    return {
      clienteEmail: this._clienteEmail,
      valor: this._valor,
      cartao: this._cartao,
      status: this._status,
    };
  }
}

module.exports = { PedidoBuilder };
