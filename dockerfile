# --- ESTÁGIO 1: Build ---
FROM node:20-alpine AS build
# Instalando dependências para pacotes nativos
RUN apk update && apk add --no-cache build-base gcc autoconf automake zlib-dev libpng-dev vips-dev > /dev/null 2>&1

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /opt/
# Copia apenas os arquivos de manifesto primeiro para aproveitar o cache
COPY package.json package-lock.json ./ 
# No Docker, usamos --frozen-lockfile ou apenas npm install para garantir consistência
RUN npm install

WORKDIR /opt/app
COPY . .
RUN npm run build

# --- ESTÁGIO 2: Runtime ---
FROM node:20-alpine
RUN apk add --no-cache vips-dev
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /opt/app
# Copiamos tudo do build para a pasta app, mantendo a estrutura
COPY --from=build /opt/node_modules ./node_modules
COPY --from=build /opt/app ./

ENV PATH /opt/app/node_modules/.bin:$PATH

RUN chown -R node:node /opt/app
USER node

EXPOSE 1337
CMD ["npm", "run", "start"]