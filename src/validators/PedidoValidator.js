/**
 * RF01 — Validação de entrada de dados (Extract Method do fluxo principal).
 * Garante presença e formato correto de clienteEmail, valor e cartao.
 */
class PedidoValidator {
  static validar(pedido) {
    const erros = [];

    if (!pedido.clienteEmail || !PedidoValidator._isEmailValido(pedido.clienteEmail)) {
      erros.push('clienteEmail inválido ou ausente');
    }

    if (typeof pedido.valor !== 'number' || pedido.valor <= 0) {
      erros.push('valor deve ser um número maior que zero');
    }

    if (
      !pedido.cartao ||
      !pedido.cartao.numero ||
      !pedido.cartao.validade ||
      !pedido.cartao.cvv
    ) {
      erros.push('cartao deve conter numero, validade e cvv');
    }

    return erros;
  }

  static _isEmailValido(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
  }
}

module.exports = { PedidoValidator };
