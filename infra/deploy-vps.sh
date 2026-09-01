#!/usr/bin/env bash
set -euo pipefail

REGISTRY="${REGISTRY:-localhost:5000}"
VERSION="${VERSION:-0.1.0}"
SRC="${SRC:-/opt/sinal/src}"
NS=sinal

log() { printf '\n>>> %s\n' "$1"; }

log "build api-telecom"
docker build -q -t "${REGISTRY}/sinal/api-telecom:${VERSION}" "${SRC}/apps/api-telecom"

log "build mcp-server"
docker build -q -t "${REGISTRY}/sinal/mcp-server:${VERSION}" "${SRC}/apps/mcp-server"

log "push"
docker push -q "${REGISTRY}/sinal/api-telecom:${VERSION}"
docker push -q "${REGISTRY}/sinal/mcp-server:${VERSION}"

log "namespace"
kubectl apply -f "${SRC}/infra/k8s/namespace.yaml"

log "secrets"
if ! kubectl -n "${NS}" get secret sinal-api-telecom >/dev/null 2>&1; then
  WORKLOAD_KEY="$(openssl rand -hex 24)"
  JWT_SECRET="$(openssl rand -hex 32)"
  kubectl -n "${NS}" create secret generic sinal-api-telecom \
    --from-literal=API_KEYS="${WORKLOAD_KEY}"
  kubectl -n "${NS}" create secret generic sinal-mcp-server \
    --from-literal=API_TELECOM_KEY="${WORKLOAD_KEY}" \
    --from-literal=JWT_SIGNING_SECRET="${JWT_SECRET}"
  echo "secrets created"
else
  echo "secrets already present, kept"
fi

log "apply"
kubectl apply -f "${SRC}/infra/k8s/api-telecom.yaml"
kubectl apply -f "${SRC}/infra/k8s/mcp-server.yaml"
kubectl apply -f "${SRC}/infra/k8s/network-policy.yaml"

log "rollout"
kubectl -n "${NS}" rollout restart deployment/sinal-api-telecom deployment/sinal-mcp-server
kubectl -n "${NS}" rollout status deployment/sinal-api-telecom --timeout=180s
kubectl -n "${NS}" rollout status deployment/sinal-mcp-server --timeout=180s

log "cleaning up stale sinal artifacts"
docker images "${REGISTRY}/sinal/*" --format '{{.Repository}}:{{.Tag}} {{.ID}}' \
  | grep -v ":${VERSION} " \
  | awk '{print $2}' \
  | xargs -r docker rmi -f || true
docker image prune -f --filter "label=org.opencontainers.image.title=sinal" >/dev/null 2>&1 || true

log "state"
kubectl -n "${NS}" get pods -o wide
