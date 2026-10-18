FROM node:22-alpine

WORKDIR /api

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

EXPOSE 8080

CMD ["node", "src/server.js"]
