FROM node:20-alpine

WORKDIR /app

COPY services/simulators/line2/package.json services/simulators/line2/package-lock.json* ./
RUN npm install --omit=dev

COPY services/simulators/line2/src ./src
COPY services/shared ./shared

ENV NODE_ENV=production
CMD ["npm", "start"]
