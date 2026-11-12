# Immagine per qualsiasi hosting che supporta Docker (Railway, Fly.io, server della scuola…)
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY scripts ./scripts
# Il database va su un volume persistente montato in /data
ENV DB_PATH=/data/business-game.sqlite
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
