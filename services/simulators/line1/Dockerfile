FROM node:20-alpine

WORKDIR /app

COPY services/simulators/line1/package.json services/simulators/line1/package-lock.json* ./
RUN npm install --omit=dev

COPY services/simulators/line1/src ./src
COPY services/shared ./shared

ENV NODE_ENV=production
CMD ["npm", "start"]
