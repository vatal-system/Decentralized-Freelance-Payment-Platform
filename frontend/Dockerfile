FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Contract addresses are baked in at build time (Vite inlines VITE_* vars).
ARG VITE_NETWORK=testnet
ARG VITE_ESCROW_CONTRACT_ID=
ARG VITE_DISPUTE_CONTRACT_ID=
ARG VITE_REPUTATION_CONTRACT_ID=
ARG VITE_USDC_CONTRACT_ID=
ENV VITE_NETWORK=$VITE_NETWORK \
    VITE_ESCROW_CONTRACT_ID=$VITE_ESCROW_CONTRACT_ID \
    VITE_DISPUTE_CONTRACT_ID=$VITE_DISPUTE_CONTRACT_ID \
    VITE_REPUTATION_CONTRACT_ID=$VITE_REPUTATION_CONTRACT_ID \
    VITE_USDC_CONTRACT_ID=$VITE_USDC_CONTRACT_ID

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
