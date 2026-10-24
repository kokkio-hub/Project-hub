# syntax=docker/dockerfile:1

# ---- Build: install everything, compile the server and bundle the web app ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# .npmrc must come first: it stops npm from trying to compile better-sqlite3 (prebuilt binaries are included).
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Runtime: only the compiled app and its production dependencies ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/project-hub.db
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
# No VOLUME instruction here: docker-compose.yml mounts a volume at /data, and some hosts
# (Railway, for example) refuse to build images that declare one.
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/index.js"]
