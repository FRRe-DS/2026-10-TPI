# ========================================================
# Dockerfile para Frontend Dashboard M8 (Grupo 10)
# Permite levantar el Backoffice React/Vite sin instalar dependencias en el host
# ========================================================

FROM node:20-alpine

WORKDIR /app

# Copiar manifiestos del monorepo para aprovechar la caché de capas
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

# Instalar dependencias del monorepo
RUN npm ci

# Copiar código fuente necesario
COPY packages/contracts ./packages/contracts
COPY apps/frontend ./apps/frontend

ENV VITE_API_BASE_URL=http://localhost:3000/api/v1

EXPOSE 5173

CMD ["npm", "run", "dev", "--workspace=@g10-m8/frontend", "--", "--host", "0.0.0.0", "--port", "5173"]
