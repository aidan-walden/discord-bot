FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
# shoukaku runs tsup in its prepare script, so devDeps must be present at install time
# --production omits tsup and the build fails
RUN bun install --frozen-lockfile

FROM oven/bun:1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "src/index.ts"]
