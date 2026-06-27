# language: pt

Funcionalidade: Processamento de Checkout e Pedidos — EntregasJá
  Como cliente da plataforma EntregasJá
  Quero processar meu pedido de entrega com segurança
  Para que meu pagamento seja confirmado ou rejeitado de forma clara e confiável

  Contexto:
    Dado que o sistema de checkout está operacional

  # =============================================================
  # Fluxo 1: Caminho Feliz — Pagamento Aprovado
  # =============================================================
  Cenário: Pagamento aprovado com sucesso (Fluxo 1)
    Dado que o cliente possui dados de pedido válidos
    E o gateway de pagamento está disponível e aprova a transação
    Quando o cliente submete o checkout
    Então o pedido deve ter status "PROCESSADO"
    E o e-mail de confirmação deve ser disparado para o cliente
    E a resposta HTTP deve ser 200

  # =============================================================
  # Fluxo 2: Falha de Negócio — Cartão Recusado
  # =============================================================
  Cenário: Cartão recusado pelo gateway (Fluxo 2)
    Dado que o cliente possui dados de pedido válidos
    E o gateway de pagamento recusa a transação com status "RECUSADO"
    Quando o cliente submete o checkout
    Então o pedido deve ter status "FALHOU"
    E o e-mail de confirmação NÃO deve ser disparado
    E a resposta HTTP deve ser 500

  # =============================================================
  # Fluxo 3: Resiliência — Recuperação via Retry
  # =============================================================
  Cenário: Recuperação após falha temporária do gateway (Fluxo 3)
    Dado que o cliente possui dados de pedido válidos
    E o gateway falha na primeira tentativa com erro de conexão
    E o gateway aprova na segunda tentativa
    Quando o cliente submete o checkout
    Então o pedido deve ter status "PROCESSADO"
    E a resposta HTTP deve ser 200

  # =============================================================
  # Fluxo 4: Caos Total — Falha Persistente de Infraestrutura
  # =============================================================
  Cenário: Falha persistente do gateway após todas as retentativas (Fluxo 4)
    Dado que o cliente possui dados de pedido válidos
    E o gateway falha em todas as tentativas com instabilidade total
    Quando o cliente submete o checkout
    Então o pedido deve ter status "ERRO_GATEWAY"
    E o e-mail de confirmação NÃO deve ser disparado
    E a resposta HTTP deve ser 500

  # =============================================================
  # Fluxo 5: Contrato — Dados Inválidos (Validação de Entrada)
  # =============================================================
  Cenário: Dados incompletos rejeitados antes do processamento (Fluxo 5)
    Dado que o cliente não forneceu email no payload
    Quando o cliente submete o checkout
    Então a resposta HTTP deve ser 400
    E o gateway de pagamento não deve ser consultado
    E o banco de dados não deve ser acessado

  Cenário: Valor zerado rejeitado na validação de entrada
    Dado que o cliente enviou um pedido com valor zero
    Quando o cliente submete o checkout
    Então a resposta HTTP deve ser 400
    E o gateway de pagamento não deve ser consultado

  Cenário: Cartão sem CVV rejeitado na validação de entrada
    Dado que o cliente enviou um cartão sem CVV
    Quando o cliente submete o checkout
    Então a resposta HTTP deve ser 400
    E o gateway de pagamento não deve ser consultado
