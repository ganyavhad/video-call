FROM node:20-alpine AS builder

# mediasoup requires build tools
RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .

FROM node:20-alpine
RUN apk add --no-cache python3 make g++ linux-headers
WORKDIR /app
COPY --from=builder /app .

RUN mkdir -p logs
EXPOSE 3000
CMD ["node", "src/index.js"]
