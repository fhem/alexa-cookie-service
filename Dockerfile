FROM node:22.23.4-bookworm-slim

WORKDIR /app
COPY package*.json ./
COPY scripts/patch-alexa-cookie2.js scripts/patch-alexa-cookie2.js

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data /data/debug-html
EXPOSE 58080 58090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node scripts/healthcheck.js
CMD ["npm", "start"]
