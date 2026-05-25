# FortSmart Cloud API — produção (Render, Railway, Oracle ARM64).
# Build: docker build -t fortsmart-api .
# Run:   docker run -d --name fortsmart-api --restart unless-stopped --env-file .env -p 3000:3000 fortsmart-api

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY ndvi ./ndvi

RUN npm run build

FROM node:22-bookworm-slim AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN chown -R node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/ndvi ./ndvi

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["npm", "run", "start"]
