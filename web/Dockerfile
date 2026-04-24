FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install
RUN npx playwright install --with-deps chromium
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]
