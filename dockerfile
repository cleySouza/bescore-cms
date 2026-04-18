# --- ESTÁGIO 1: Build ---
FROM node:20-alpine AS build
# Dependências nativas necessárias para compilar pacotes como 'sharp' ou 'pg'
RUN apk update && apk add --no-cache build-base gcc autoconf automake zlib-dev libpng-dev vips-dev

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /opt/
COPY package.json package-lock.json ./
# Instalamos tudo (incluindo devDeps) para conseguir buildar o Admin
RUN npm install

WORKDIR /opt/app
COPY . .
RUN npm run build

# --- ESTÁGIO 2: Runtime ---
FROM node:20-alpine
# vips-dev é necessário para o processamento de imagens (Sharp) no Strapi
RUN apk add --no-cache vips-dev
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /opt/app

# COPIA ESTRATÉGICA:
# Copiamos as node_modules que têm o 'pg' e o 'sharp' compilados
COPY --from=build /opt/node_modules ./node_modules
# Copiamos o código buildado
COPY --from=build /opt/app ./

ENV PATH /opt/app/node_modules/.bin:$PATH

# Garante que o usuário node tenha permissão na pasta do app
RUN chown -R node:node /opt/app
USER node

EXPOSE 1337
CMD ["npm", "run", "start"]