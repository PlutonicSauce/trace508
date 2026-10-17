FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx prisma generate && npx playwright install --with-deps chromium
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
RUN mkdir -p /app/.local && chown -R node:node /app/.local /ms-playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER node
EXPOSE 3000
CMD ["npm","run","start"]
