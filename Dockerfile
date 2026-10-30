FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV PORT=8787 DATA_DIR=/data
EXPOSE 8787
CMD ["node", "server/server.mjs"]
