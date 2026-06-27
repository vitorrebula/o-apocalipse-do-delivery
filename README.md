# O Apocalipse do Delivery — Microsserviço de Checkout Blindado

Intrgrantes
* Thales Mattos
* Vitor Rebula

Link para o vídeo:
https://drive.google.com/drive/folders/1AUq6Y5xWDjzUDxQcXTtneT46k_xHIWGG?usp=drive_link

Link para o vídeo: https://drive.google.com/drive/folders/1AUq6Y5xWDjzUDxQcXTtneT46k_xHIWGG?usp=drive_link

---

## Visão Geral

**Fase 4 (Caos & SRE)**
No arquivo server.js, a função gatewayPagamentoMock.cobrar simula uma promessa de 300ms. Quando vocês configurarem o Toxiproxy, vocês interceptarão essa chamada externa e forçarão uma latência de 5000ms. O k6 vai disparar requisições para /api/v1/checkout e o grupo deverá avaliar se o Express vai sofrer um colapso ou se o código de vocês (redesenhado com circuit breaker ou timeouts curtos) vai proteger o servidor.
