FROM node:20-alpine AS build

WORKDIR /app

COPY services/ingest/package.json services/ingest/package-lock.json* ./services/ingest/
WORKDIR /app/services/ingest
RUN npm install

WORKDIR /app
COPY services ./services
WORKDIR /app/services/ingest
RUN npm run build

FROM node:20-alpine

WORKDIR /app/services/ingest

COPY services/ingest/package.json services/ingest/package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/services/ingest/dist ./dist

ENV NODE_ENV=production
CMD ["npm", "start"]
