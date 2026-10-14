FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY scripts ./scripts
# The Prisma CLI (for "migrate deploy" at startup) has many dependencies the traced app doesn't include,
# so it gets its own install. Keep this version in step with "prisma" in package.json.
RUN npm install --prefix /opt/prisma-cli --no-save --no-audit --no-fund prisma@6.19.3
EXPOSE 3000
CMD ["sh", "-c", "/opt/prisma-cli/node_modules/.bin/prisma migrate deploy && node server.js"]
