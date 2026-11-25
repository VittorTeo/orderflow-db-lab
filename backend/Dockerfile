FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# Dependências antes do código: a camada fica em cache enquanto o lock não mudar
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
EXPOSE 3000
# node direto, e não npm start, para o processo receber SIGTERM
CMD ["node", "src/server.js"]
