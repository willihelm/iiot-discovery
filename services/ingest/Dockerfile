FROM node:20-alpine

WORKDIR /app

COPY services/ingest/package.json services/ingest/package-lock.json* ./
RUN npm install --omit=dev

COPY services/ingest/src ./src
COPY services/shared ./shared

ENV NODE_ENV=production
CMD ["npm", "start"]
