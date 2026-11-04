FROM node:20-alpine

WORKDIR /app

COPY servidor.js ./

USER node

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/salud || exit 1

CMD ["node", "servidor.js"]