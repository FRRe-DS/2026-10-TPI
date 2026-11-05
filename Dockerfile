# ========================================================
# Dockerfile Multi-stage para Backend M8 (Grupo 10)
# Cumple con RNF-04 (Imágenes OCI reproducibles y versionadas)
# ========================================================

# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder

# OpenSSL es necesario para que Prisma detecte la versión correcta de su motor
RUN apk add --no-cache openssl

WORKDIR /app

# Copiar archivos de dependencias del monorepo
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

# Instalar dependencias
RUN npm ci

# Copiar código fuente y esquemas
COPY packages/contracts ./packages/contracts
COPY apps/backend ./apps/backend

# Generar cliente de Prisma
RUN npm run prisma:generate --workspace=apps/backend

# Compilar contratos y backend
RUN npm run build --workspace=@g10-m8/contracts && \
    npm run build --workspace=@g10-m8/backend

# Stage 2: Production Runtime
FROM node:20-alpine AS runner

# OpenSSL es necesario para que Prisma cargue su motor en tiempo de ejecución
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copiar estructura y compilados
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/contracts ./packages/contracts
COPY --from=builder /app/apps/backend/package.json ./apps/backend/
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/prisma ./apps/backend/prisma

# Ejecutar como usuario no privilegiado (buenas prácticas OCI / RNF-12)
USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

# Está línea asegura que la base de datos esté sincronizada antes de iniciar el servidor
CMD ["sh", "-c", "npx prisma db push --schema=apps/backend/prisma/schema.prisma --skip-generate && node apps/backend/dist/main"]
