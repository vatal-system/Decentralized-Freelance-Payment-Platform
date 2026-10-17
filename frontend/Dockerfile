FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Vite resolves `import.meta.env.VITE_*` at build time, so every value the app
# reads has to be a build arg: the only way to point a running container at a
# different backend or contract set is to rebuild the image with it.
#
# VITE_API_URL (frontend/src/lib/api.ts) and VITE_XLM_CONTRACT_ID
# (frontend/src/lib/assets.ts) are as load-bearing as the contract ids: without
# them a containerised build falls back to http://localhost:3000 and cannot pay
# in XLM. docker-compose.yml forwards all of them from the shell.
ARG VITE_NETWORK=testnet
ARG VITE_API_URL=
ARG VITE_ESCROW_CONTRACT_ID=
ARG VITE_DISPUTE_CONTRACT_ID=
ARG VITE_REPUTATION_CONTRACT_ID=
ARG VITE_USDC_CONTRACT_ID=
ARG VITE_XLM_CONTRACT_ID=
# Optional: only needed if the RPC provider rejects simulations whose source
# account is not on the ledger (see docs/DEPLOYMENT.md). Reads work without it.
ARG VITE_READONLY_SOURCE=
ENV VITE_NETWORK=$VITE_NETWORK \
    VITE_API_URL=$VITE_API_URL \
    VITE_ESCROW_CONTRACT_ID=$VITE_ESCROW_CONTRACT_ID \
    VITE_DISPUTE_CONTRACT_ID=$VITE_DISPUTE_CONTRACT_ID \
    VITE_REPUTATION_CONTRACT_ID=$VITE_REPUTATION_CONTRACT_ID \
    VITE_USDC_CONTRACT_ID=$VITE_USDC_CONTRACT_ID \
    VITE_XLM_CONTRACT_ID=$VITE_XLM_CONTRACT_ID \
    VITE_READONLY_SOURCE=$VITE_READONLY_SOURCE

RUN npm run build

# Unprivileged nginx (runs as `nginx`, uid 101): pid file and temp paths live
# under /tmp and the master process never holds root, so a bug in a request
# path is contained to an unprivileged user (CIS 4.1). It listens on 8080
# because a non-root process cannot bind port 80 — see nginx.conf and the
# port mapping in docker-compose.yml.
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html
COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
# Stated explicitly (not just inherited from the base image) so the intent is
# visible — and testable — right here.
USER nginx
EXPOSE 8080
