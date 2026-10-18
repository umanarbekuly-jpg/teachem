FROM node:22-bookworm-slim AS build
RUN npm install -g pnpm@10.17.1
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @tutor/shared build && pnpm --filter @tutor/web build
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
