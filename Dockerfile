FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# Install ALL dependencies including devDependencies (needed for esbuild)
RUN npm install

COPY . .

# Build TypeScript with esbuild
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]