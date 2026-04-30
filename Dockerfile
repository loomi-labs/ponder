# syntax=docker/dockerfile:1.7
# Frankencoin Ponder indexer — production image.
# Build: docker build -t fc-ponder .
# Run:   docker run -d --name fc-ponder \
#          -e ALCHEMY_RPC_KEY=<key> \
#          -e DATABASE_URL=postgres://user:pass@host:5432/ponder \
#          -e MAX_REQUESTS_PER_SECOND=1 \
#          -p 42069:42069 \
#          fc-ponder

# ---- deps ----
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# ---- runner ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 ponder

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=ponder:nodejs . .

USER ponder
EXPOSE 42069

# ALCHEMY_RPC_KEY, DATABASE_URL, MAX_REQUESTS_PER_SECOND, POLLING_INTERVAL_MS
# come from `docker run -e ...` at runtime — nothing baked in.
# DATABASE_SCHEMA defaults to "frankencoin"; override per-environment if you
# want to run multiple ponder instances against one Postgres.
ENV PORT=42069 \
    DATABASE_SCHEMA=frankencoin
CMD ["yarn", "start"]
