# ── deps: install node_modules inside the image ───────────────────────────────
# Keeping this as a separate layer means `npm ci` only reruns when
# package-lock.json changes, not on every source change.
FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
# --legacy-peer-deps: @tiptap/extension-collaboration-cursor@2.x declares
# a peer dep on @tiptap/core@^2.x while the project uses 3.x. The
# package-lock.json was generated with this flag; ci must match.
RUN npm ci --legacy-peer-deps

# ── development ───────────────────────────────────────────────────────────────
# The image contains the correct Linux-built node_modules.
# docker-compose bind-mounts the source and uses an anonymous volume to
# shadow /app/node_modules with the image's copy, preventing the host's
# macOS/Windows node_modules from leaking into the container.
FROM node:20-alpine AS development

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
# Copy source so the image is self-contained even without a bind mount
COPY . .

EXPOSE 3010

HEALTHCHECK --interval=20s --timeout=10s --start-period=90s --retries=5 \
    CMD wget -qO- http://localhost:3010 > /dev/null 2>&1 || exit 1

CMD ["npm", "run", "dev"]

# ── builder: full production build ────────────────────────────────────────────
FROM deps AS builder

WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# standalone output packs server.js + minimal runtime into .next/standalone
RUN npm run build

# ── runner: minimal production image ─────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3010

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:3010 > /dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
