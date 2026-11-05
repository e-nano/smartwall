FROM node:25-bookworm-slim AS build
WORKDIR /app
COPY platform/package.json platform/package-lock.json ./
RUN npm ci
COPY platform/backend ./backend
COPY platform/frontend ./frontend
COPY platform/shared ./shared
RUN ./node_modules/.bin/tsc -p backend/tsconfig.json && ./node_modules/.bin/vite build --config frontend/vite.config.ts

FROM node:25-bookworm-slim AS runtime
ARG VERSION=development
ENV NODE_ENV=production SMARTWALL_VERSION=$VERSION DATA_DIR=/var/lib/smartwall/data FIRMWARE_DIR=/var/lib/smartwall/firmware FRONTEND_DIR=/app/frontend/dist
WORKDIR /app
COPY platform/package.json platform/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/shared ./shared
USER node
EXPOSE 8080 8081 4210/udp
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","backend/dist/index.js"]
