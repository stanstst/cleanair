FROM node:22-alpine

WORKDIR /fetcher

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

CMD ["node", "src/job.js"]
