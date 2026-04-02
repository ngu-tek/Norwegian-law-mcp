# ═══════════════════════════════════════════════════════════════════════════
# MCP SERVER DOCKERFILE
# ═══════════════════════════════════════════════════════════════════════════
#
# Multi-stage Dockerfile for building and running the MCP server.
#
# IMPORTANT: The database must be pre-built BEFORE running docker build.
# It is NOT built during the Docker build because the full DB includes
# ingested data (12K+ case law entries) that requires hours of network
# scraping. Build it locally first, then bake it into the image.
#
# Free tier (seeds only, ~45 MB):
#   npm run build:db
#   docker build -t norwegian-law-mcp .
#
# Full tier (seeds + ingested case law, ~80 MB):
#   npm run build:db
#   npm run ingest:cases:full-archive
#   npm run build:db:paid
#   docker build -t norwegian-law-mcp .
#
# ═══════════════════════════════════════════════════════════════════════════

# ───────────────────────────────────────────────────────────────────────────
# STAGE 1: BUILD
# ───────────────────────────────────────────────────────────────────────────
# Compiles TypeScript to JavaScript
# ───────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install ALL dependencies (including dev)
# --ignore-scripts prevents postinstall from running
RUN npm ci --ignore-scripts

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript
RUN npm run build

# ───────────────────────────────────────────────────────────────────────────
# STAGE 2: PRODUCTION
# ───────────────────────────────────────────────────────────────────────────
# Minimal image with only production dependencies
# ───────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy compiled JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Copy pre-built database
# This file MUST exist — run `npm run build:db` (or full pipeline) first
COPY data/database.db ./data/database.db
RUN node --input-type=module - <<'NODE'
import Database from '@ansvar/mcp-sqlite';
import { searchLegislation } from './dist/tools/search-legislation.js';
const db = new Database('./data/database.db', { readonly: true });
const tables = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name)
);
for (const table of ['legal_documents', 'legal_provisions', 'provisions_fts']) {
  if (!tables.has(table)) {
    throw new Error(`Missing required table: ${table}`);
  }
}
const result = await searchLegislation(db, { query: 'personopplysninger', limit: 1 });
if (!result.results.length) {
  throw new Error('Search smoke test returned no Norwegian law results');
}
db.close();
NODE

# ───────────────────────────────────────────────────────────────────────────
# SECURITY
# ───────────────────────────────────────────────────────────────────────────
# Create and use non-root user
# ───────────────────────────────────────────────────────────────────────────

RUN addgroup -S nodejs && adduser -S nodejs -G nodejs \
 && chown -R nodejs:nodejs /app/data
USER nodejs

# ───────────────────────────────────────────────────────────────────────────
# ENVIRONMENT
# ───────────────────────────────────────────────────────────────────────────

# Production mode
ENV NODE_ENV=production

# Database path (matches the COPY destination above)
ENV NORWEGIAN_LAW_DB_PATH=/app/data/database.db

# ───────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ───────────────────────────────────────────────────────────────────────────
# MCP servers use stdio, so we run node directly
# ───────────────────────────────────────────────────────────────────────────

CMD ["node", "dist/http-server.js"]
