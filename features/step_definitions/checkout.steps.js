const { Given, When, Then, Before, AfterAll } = require('@cucumber/cucumber');
const assert = require('assert');
const { CheckoutService } = require('../../src/services/CheckoutService');
const { PedidoValidator } = require('../../src/validators/PedidoValidator');
const { PedidoBuilder } = require('../../tests/builders/PedidoBuilder');

// Estado compartilhado entre steps do mesmo cenário
let pedidoPayload;
let gatewayStub;
let repositoryStub;
let emailStub;
let checkoutService;
let resultado;
let httpStatus;
let gatewayFoiChamado;
let repositorioFoiChamado;
let ultimoPedidoSalvo;

Before(function () {
  gatewayFoiChamado = false;
  repositorioFoiChamado = false;
  resultado = null;
  httpStatus = null;
  ultimoPedidoSalvo = null;

  gatewayStub = {
    cobrar: async (valor, cartao) => {
      gatewayFoiChamado = true;
      return { status: 'APROVADO' };
    },
  };

  repositoryStub = {
    salvar: async (pedido) => {
      repositorioFoiChamado = true;
      ultimoPedidoSalvo = { ...pedido };
      return { ...pedido, id: 99 };
    },
  };

  emailStub = {
    enviarConfirmacao: async (email, msg) => undefined,
    _chamado: false,
  };

  const emailOriginal = emailStub.enviarConfirmacao;
  emailStub.enviarConfirmacao = async function (...args) {
    emailStub._chamado = true;
    return emailOriginal(...args);
  };
});

// ---- Contexto / Setup ----

Given('que o sistema de checkout está operacional', function () {
  // Ambiente já preparado no Before
});

Given('que o cliente possui dados de pedido válidos', function () {
  pedidoPayload = new PedidoBuilder().build();
});

Given('o gateway de pagamento está disponível e aprova a transação', function () {
  gatewayStub.cobrar = async () => { gatewayFoiChamado = true; return { status: 'APROVADO' }; };
});

Given('o gateway de pagamento recusa a transação com status {string}', function (statusGateway) {
  gatewayStub.cobrar = async () => { gatewayFoiChamado = true; return { status: statusGateway }; };
});

Given('o gateway falha na primeira tentativa com erro de conexão', function () {
  let tentativas = 0;
  gatewayStub.cobrar = async () => {
    gatewayFoiChamado = true;
    tentativas++;
    if (tentativas === 1) throw new Error('Conexão recusada');
    return { status: 'APROVADO' };
  };
});

Given('o gateway aprova na segunda tentativa', function () {
  // Configurado no step anterior (estado já preparado)
});

Given('o gateway falha em todas as tentativas com instabilidade total', function () {
  gatewayStub.cobrar = async () => {
    gatewayFoiChamado = true;
    throw new Error('Gateway offline');
  };
});

Given('que o cliente não forneceu email no payload', function () {
  pedidoPayload = new PedidoBuilder().comEmail(null).build();
});

Given('que o cliente enviou um pedido com valor zero', function () {
  pedidoPayload = new PedidoBuilder().comValor(0).build();
});

Given('que o cliente enviou um cartão sem CVV', function () {
  pedidoPayload = new PedidoBuilder()
    .comCartao({ numero: '4111111111111111', validade: '12/27' })
    .build();
});

// ---- Ação ----

When('o cliente submete o checkout', async function () {
  const erros = PedidoValidator.validar(pedidoPayload);

  if (erros.length > 0) {
    httpStatus = 400;
    resultado = null;
    return;
  }

  checkoutService = new CheckoutService(
    gatewayStub,
    repositoryStub,
    emailStub,
    { maxRetries: 3, backoffMs: 0 }
  );

  resultado = await checkoutService.processar({ ...pedidoPayload });

  if (resultado && resultado.status === 'PROCESSADO') {
    httpStatus = 200;
  } else {
    httpStatus = 500;
  }

  // Aguarda fire-and-forget de e-mail
  await new Promise(resolve => setImmediate(resolve));
});

// ---- Asserções ----

Then('o pedido deve ter status {string}', function (statusEsperado) {
  // Para PROCESSADO, verifica o resultado retornado; para outros estados, verifica o pedido salvo
  const statusReal = resultado ? resultado.status : (ultimoPedidoSalvo && ultimoPedidoSalvo.status);
  assert.ok(statusReal, `Nenhum status encontrado — esperado: ${statusEsperado}`);
  assert.strictEqual(statusReal, statusEsperado);
});

Then('o e-mail de confirmação deve ser disparado para o cliente', function () {
  assert.strictEqual(emailStub._chamado, true, 'E-mail deveria ter sido enviado');
});

Then('o e-mail de confirmação NÃO deve ser disparado', function () {
  assert.strictEqual(emailStub._chamado, false, 'E-mail NÃO deveria ter sido enviado');
});

Then('a resposta HTTP deve ser {int}', function (codigoEsperado) {
  assert.strictEqual(httpStatus, codigoEsperado);
});

Then('o gateway de pagamento não deve ser consultado', function () {
  assert.strictEqual(gatewayFoiChamado, false, 'Gateway não deveria ter sido chamado');
});

Then('o banco de dados não deve ser acessado', function () {
  assert.strictEqual(repositorioFoiChamado, false, 'Repositório não deveria ter sido chamado');
});
