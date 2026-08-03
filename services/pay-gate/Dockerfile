FROM node:22-trixie-slim
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install --global @solana/pay@1.0.26 \
 && pay --help >/dev/null
COPY infra/paywall-cloud.yml /app/paywall.yml
ENV PORT=8080
CMD ["sh", "-c", "pay --sandbox gate api /app/paywall.yml --bind 0.0.0.0:${PORT} --no-register"]
