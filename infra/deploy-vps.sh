#!/usr/bin/env bash
set -euo pipefail

REGISTRY="${REGISTRY:-localhost:5000}"
VERSION="${VERSION:-0.1.0}"
SRC="${SRC:-/opt/sinal/src}"
NS=sinal

WEB_HOST="${WEB_HOST:-app.sinal.brandaodeveloper.com.br}"
BFF_HOST="${BFF_HOST:-api.sinal.brandaodeveloper.com.br}"

log() { printf '\n>>> %s\n' "$1"; }

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
  echo "api-telecom and mcp-server secrets created"
else
  echo "api-telecom and mcp-server secrets already present, kept"
fi
if ! kubectl -n "${NS}" get secret sinal-bff >/dev/null 2>&1; then
  kubectl -n "${NS}" create secret generic sinal-bff \
    --from-literal=SESSION_SECRET="$(openssl rand -hex 32)"
  echo "bff secret created"
else
  echo "bff secret already present, kept"
fi

log "build images"
docker build -q -t "${REGISTRY}/sinal/api-telecom:${VERSION}" "${SRC}/apps/api-telecom"
docker build -q -t "${REGISTRY}/sinal/mcp-server:${VERSION}" "${SRC}/apps/mcp-server"
docker build -q -t "${REGISTRY}/sinal/agent:${VERSION}" "${SRC}/apps/agent"
docker build -q -t "${REGISTRY}/sinal/bff:${VERSION}" "${SRC}/apps/bff"
docker build -q --build-arg "VITE_BFF_URL=https://${BFF_HOST}" \
  -t "${REGISTRY}/sinal/web:${VERSION}" "${SRC}/apps/web"

log "push"
for svc in api-telecom mcp-server agent bff web; do
  docker push -q "${REGISTRY}/sinal/${svc}:${VERSION}"
done

log "apply manifests"
kubectl apply -f "${SRC}/infra/k8s/redis.yaml"
kubectl apply -f "${SRC}/infra/k8s/api-telecom.yaml"
kubectl apply -f "${SRC}/infra/k8s/mcp-server.yaml"
kubectl apply -f "${SRC}/infra/k8s/agent.yaml"
kubectl apply -f "${SRC}/infra/k8s/bff.yaml"
kubectl apply -f "${SRC}/infra/k8s/web.yaml"
kubectl apply -f "${SRC}/infra/k8s/network-policy.yaml"
kubectl apply -f "${SRC}/infra/k8s/hpa.yaml"

log "rollout"
for dep in api-telecom mcp-server agent bff web; do
  kubectl -n "${NS}" rollout restart "deployment/sinal-${dep}"
done
for dep in api-telecom mcp-server agent bff web; do
  kubectl -n "${NS}" rollout status "deployment/sinal-${dep}" --timeout=180s
done

log "cleaning up stale sinal artifacts"
docker images "${REGISTRY}/sinal/*" --format '{{.Repository}}:{{.Tag}} {{.ID}}' \
  | grep -v ":${VERSION} " \
  | awk '{print $2}' \
  | xargs -r docker rmi -f || true

log "state"
kubectl -n "${NS}" get pods -o wide
