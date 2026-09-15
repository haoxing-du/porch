FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DEV_AUTH=false
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/dist/web ./dist/web
RUN mkdir -p /app/.local/uploads && chown -R node:node /app/.local
USER node
EXPOSE 3001
CMD ["npm", "start"]
