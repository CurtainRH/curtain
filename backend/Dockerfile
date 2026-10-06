# Curtain operator (and keeper) image. Build context is backend/ (the Bun workspace root).
#   operator: bun run --cwd services/operator start (default)
#   keeper:   bun run --cwd services/keeper start
FROM oven/bun:1-alpine
WORKDIR /app

ENV NODE_ENV=production

# Copy workspace configuration and packages/services
COPY package.json bun.lock tsconfig.base.json ./
COPY db ./db
COPY packages ./packages
COPY services ./services

# Install production dependencies and link workspace packages
RUN bun install --frozen-lockfile --production

EXPOSE 3100
USER bun
CMD ["bun", "run", "--cwd", "services/operator", "start"]
