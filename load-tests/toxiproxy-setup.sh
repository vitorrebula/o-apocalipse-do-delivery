#!/usr/bin/env bash
# =============================================================================
# Fase 4 — Orquestrador de Engenharia do Caos (Toxiproxy via Docker)
#
# Arquitetura validada:
#
#   k6  ──►  EntregasJá (Express :3000)  ──►  Toxiproxy (:8475)  ──►  Fake Gateway (:9000)
#                                              [injeta latência / queda]
#
# O Toxiproxy fica ENTRE o microsserviço e o gateway de pagamento externo,
# permitindo injetar latência (Gateway Lento) e quedas (Thundering Herd) na
# comunicação de rede real, exatamente onde o timeout/retry/circuit breaker atuam.
#
# Pré-requisitos: docker, k6, node (com deps instaladas via `npm install`).
#
# Uso:
#   chmod +x load-tests/toxiproxy-setup.sh
#   ./load-tests/toxiproxy-setup.sh <cenario>
#
#   Cenários:
#     baseline         Carga k6 sem caos (linha de base para comparação)
#     gateway_lento    Injeta 5000ms de latência durante a carga + calcula MTTR
#     thundering_herd  Derruba o gateway abruptamente sob carga máxima + MTTR
#     cleanup          Encerra servidores e remove o container do Toxiproxy
# =============================================================================
set -uo pipefail

PROJ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY_PORT=9000
SERVER_PORT=3000
TOXI_API="localhost:8474"
PROXY_PORT=8475
PROXY_NAME="gateway"
TOXI_CONTAINER="toxiproxy"
K6_FULL="$PROJ_DIR/load-tests/k6-checkout.js"
LOGDIR="$PROJ_DIR/load-tests/logs"
mkdir -p "$LOGDIR"

log() { echo -e "\n\033[1;36m[fase4]\033[0m $*"; }

# ----------------------------------------------------------------------------
# Infraestrutura
# ----------------------------------------------------------------------------
start_gateway() {
  log "Subindo Fake Gateway de Pagamento (porta ${GATEWAY_PORT})..."
  GATEWAY_PORT=$GATEWAY_PORT node "$PROJ_DIR/src/gateway/fakeGatewayServer.js" \
    > "$LOGDIR/gateway.log" 2>&1 &
  echo $! > "$LOGDIR/gateway.pid"
}

start_server() {
  log "Subindo EntregasJá (porta ${SERVER_PORT}) apontando para o Toxiproxy..."
  GATEWAY_URL="http://localhost:${PROXY_PORT}" \
  CHECKOUT_TIMEOUT_MS="${CHECKOUT_TIMEOUT_MS:-2000}" \
  CHECKOUT_MAX_RETRIES="${CHECKOUT_MAX_RETRIES:-3}" \
  CHECKOUT_BACKOFF_MS="${CHECKOUT_BACKOFF_MS:-500}" \
    node "$PROJ_DIR/src/server.js" > "$LOGDIR/server.log" 2>&1 &
  echo $! > "$LOGDIR/server.pid"
}

start_toxiproxy() {
  log "Subindo Toxiproxy via Docker..."
  docker rm -f "$TOXI_CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$TOXI_CONTAINER" \
    --add-host=host.docker.internal:host-gateway \
    -p 8474:8474 -p ${PROXY_PORT}:${PROXY_PORT} \
    ghcr.io/shopify/toxiproxy >/dev/null
  # espera a API responder
  for _ in $(seq 1 20); do
    curl -sf "${TOXI_API}/version" >/dev/null 2>&1 && break
    sleep 0.5
  done
}

create_proxy() {
  log "Criando proxy '${PROXY_NAME}' (${PROXY_PORT} → gateway ${GATEWAY_PORT})..."
  curl -s -XPOST "${TOXI_API}/proxies" -H 'Content-Type: application/json' \
    -d "{\"name\":\"${PROXY_NAME}\",\"listen\":\"0.0.0.0:${PROXY_PORT}\",\"upstream\":\"host.docker.internal:${GATEWAY_PORT}\"}" \
    >/dev/null
}

add_latency()    { curl -s -XPOST "${TOXI_API}/proxies/${PROXY_NAME}/toxics" -H 'Content-Type: application/json' -d "{\"type\":\"latency\",\"attributes\":{\"latency\":${1:-5000}}}" >/dev/null; }
remove_toxics()  { curl -s "${TOXI_API}/proxies/${PROXY_NAME}/toxics" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | while read -r t; do curl -s -XDELETE "${TOXI_API}/proxies/${PROXY_NAME}/toxics/${t}" >/dev/null; done; }
disable_proxy()  { curl -s -XPOST "${TOXI_API}/proxies/${PROXY_NAME}" -H 'Content-Type: application/json' -d '{"enabled":false}' >/dev/null; }
enable_proxy()   { curl -s -XPOST "${TOXI_API}/proxies/${PROXY_NAME}" -H 'Content-Type: application/json' -d '{"enabled":true}' >/dev/null; }

cleanup() {
  log "Encerrando infraestrutura..."
  [ -f "$LOGDIR/server.pid" ]  && kill "$(cat "$LOGDIR/server.pid")"  2>/dev/null || true
  [ -f "$LOGDIR/gateway.pid" ] && kill "$(cat "$LOGDIR/gateway.pid")" 2>/dev/null || true
  rm -f "$LOGDIR/server.pid" "$LOGDIR/gateway.pid"
  docker rm -f "$TOXI_CONTAINER" >/dev/null 2>&1 || true
  log "Cleanup concluído."
}

infra_up() {
  start_gateway
  start_toxiproxy
  create_proxy
  start_server
  sleep 2
  log "Infra pronta. Probe de saúde:"
  curl -s -o /dev/null -w "  checkout -> HTTP %{http_code} em %{time_total}s\n" \
    -X POST "localhost:${SERVER_PORT}/api/v1/checkout" -H 'Content-Type: application/json' \
    -d '{"clienteEmail":"probe@x.com","valor":10,"cartao":{"numero":"4111111111111111","validade":"12/27","cvv":"123"}}'
}

# Probe contínuo em background: loga status/tempo de cada checkout a cada 1s.
# Usado para medir visualmente o início da degradação e o MTTR.
start_probe() {
  ( while true; do
      ts=$(date +%H:%M:%S)
      res=$(curl -s -o /dev/null -w "HTTP %{http_code} em %{time_total}s" \
        -X POST "localhost:${SERVER_PORT}/api/v1/checkout" -H 'Content-Type: application/json' \
        -d '{"clienteEmail":"probe@x.com","valor":10,"cartao":{"numero":"4111111111111111","validade":"12/27","cvv":"123"}}')
      echo "[$ts] $res"
      sleep 1
    done ) > "$LOGDIR/probe.log" 2>&1 &
  echo $! > "$LOGDIR/probe.pid"
}
stop_probe() { [ -f "$LOGDIR/probe.pid" ] && kill "$(cat "$LOGDIR/probe.pid")" 2>/dev/null; rm -f "$LOGDIR/probe.pid"; }

# Mede MTTR: após a falha cessar, quanto tempo até o checkout voltar a responder 200 rápido.
medir_mttr() {
  local inicio fim
  inicio=$(date +%s.%N)
  while true; do
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "localhost:${SERVER_PORT}/api/v1/checkout" \
      -H 'Content-Type: application/json' \
      -d '{"clienteEmail":"mttr@x.com","valor":10,"cartao":{"numero":"4111111111111111","validade":"12/27","cvv":"123"}}')
    [ "$code" = "200" ] && break
    sleep 0.2
  done
  fim=$(date +%s.%N)
  echo "$(echo "$fim - $inicio" | bc)"
}

# ----------------------------------------------------------------------------
# Cenários
# ----------------------------------------------------------------------------
cenario_baseline() {
  trap cleanup EXIT
  infra_up
  log "=== BASELINE: carga k6 sem caos ==="
  BASE_URL="http://localhost:${SERVER_PORT}" k6 run \
    --summary-export="$LOGDIR/baseline-summary.json" "$K6_FULL" 2>&1 | tee "$LOGDIR/baseline.log"
  log "Baseline concluído. Resumo: $LOGDIR/baseline-summary.json"
}

cenario_gateway_lento() {
  export CHECKOUT_CB_RESET_MS=5000   # reset ágil do circuit breaker p/ MTTR demonstrável
  trap cleanup EXIT
  infra_up
  start_probe
  log "=== GATEWAY LENTO: 5000ms de latência injetada durante a carga ==="

  ( sleep 45;  log ">>> INJETANDO latência de 5000ms no gateway"; add_latency 5000
    sleep 50;  log ">>> REMOVENDO latência (gateway recupera)";     remove_toxics ) &

  BASE_URL="http://localhost:${SERVER_PORT}" k6 run \
    --summary-export="$LOGDIR/gateway-lento-summary.json" "$K6_FULL" 2>&1 | tee "$LOGDIR/gateway-lento.log"

  stop_probe
  log "MTTR (tempo até o 1º checkout 200 após recuperação): $(medir_mttr)s"
  log "Resumo: $LOGDIR/gateway-lento-summary.json | Probe: $LOGDIR/probe.log"
}

cenario_thundering_herd() {
  export CHECKOUT_CB_RESET_MS=5000
  trap cleanup EXIT
  infra_up
  start_probe
  log "=== THUNDERING HERD: queda abrupta do gateway sob carga máxima ==="

  ( sleep 45
    log ">>> DERRUBANDO o gateway (proxy disabled) — manada estourada!"; disable_proxy
    curl -s -XPOST "localhost:${SERVER_PORT}/api/v1/cache/flush" >/dev/null
    sleep 45
    log ">>> RELIGANDO o gateway (proxy enabled)"; enable_proxy ) &

  BASE_URL="http://localhost:${SERVER_PORT}" k6 run \
    --summary-export="$LOGDIR/thundering-herd-summary.json" "$K6_FULL" 2>&1 | tee "$LOGDIR/thundering-herd.log"

  stop_probe
  log "MTTR (recuperação após religar o gateway): $(medir_mttr)s"
  log "Resumo: $LOGDIR/thundering-herd-summary.json | Probe: $LOGDIR/probe.log"
}

# ----------------------------------------------------------------------------
case "${1:-}" in
  baseline)        cenario_baseline ;;
  gateway_lento)   cenario_gateway_lento ;;
  thundering_herd) cenario_thundering_herd ;;
  cleanup)         cleanup ;;
  *)
    echo "Uso: $0 [baseline|gateway_lento|thundering_herd|cleanup]"
    exit 1
    ;;
esac
