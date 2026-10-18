FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.17.1
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm db:generate && pnpm --filter @tutor/shared build && pnpm --filter @tutor/api build
ENV NODE_ENV=production
USER node
EXPOSE 4000
CMD ["pnpm", "--filter", "@tutor/api", "start"]
