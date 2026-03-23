FROM node:20-alpine AS build

WORKDIR /app

COPY services/simulators/sparkplug/package.json services/simulators/sparkplug/package-lock.json* ./services/simulators/sparkplug/
WORKDIR /app/services/simulators/sparkplug
RUN npm install

WORKDIR /app
COPY services ./services
WORKDIR /app/services/simulators/sparkplug
RUN npm run build

FROM node:20-alpine

WORKDIR /app/services/simulators/sparkplug

COPY services/simulators/sparkplug/package.json services/simulators/sparkplug/package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/services/simulators/sparkplug/dist ./dist

ENV NODE_ENV=production
CMD ["npm", "start"]
