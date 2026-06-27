const { PedidoBuilder } = require('./PedidoBuilder');

/**
 * Padrão Object Mother — fornece instâncias prontas dos estados mais comuns de pedido.
 * Complementa o PedidoBuilder para estados de borda e cenários de falha.
 */
class PedidoMother {
  static pedidoValido() {
    return new PedidoBuilder().build();
  }

  static pedidoSemEmail() {
    return new PedidoBuilder().comEmail(null).build();
  }

  static pedidoEmailInvalido() {
    return new PedidoBuilder().comEmail('email-sem-arroba').build();
  }

  static pedidoComValorZero() {
    return new PedidoBuilder().comValor(0).build();
  }

  static pedidoComValorNegativo() {
    return new PedidoBuilder().comValor(-50).build();
  }

  static pedidoSemCartao() {
    return new PedidoBuilder().comCartao(null).build();
  }

  static pedidoCartaoSemCvv() {
    return new PedidoBuilder()
      .comCartao({ numero: '4111111111111111', validade: '12/27' })
      .build();
  }

  static pedidoAltoValor() {
    return new PedidoBuilder().comValor(9999.99).build();
  }
}

module.exports = { PedidoMother };
