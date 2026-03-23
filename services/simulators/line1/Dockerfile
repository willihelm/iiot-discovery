FROM node:20-alpine AS build

WORKDIR /app

COPY services/simulators/line1/package.json services/simulators/line1/package-lock.json* ./services/simulators/line1/
WORKDIR /app/services/simulators/line1
RUN npm install

WORKDIR /app
COPY services ./services
WORKDIR /app/services/simulators/line1
RUN npm run build

FROM node:20-alpine

WORKDIR /app/services/simulators/line1

COPY services/simulators/line1/package.json services/simulators/line1/package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/services/simulators/line1/dist ./dist

ENV NODE_ENV=production
CMD ["npm", "start"]
