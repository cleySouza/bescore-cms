# --- ESTÁGIO 1: Build ---
FROM node:20-alpine AS build
# Dependências necessárias para compilar o Sharp (essencial para as imagens do BeScore)
RUN apk update && apk add --no-cache build-base gcc autoconf automake zlib-dev libpng-dev vips-dev > /dev/null 2>&1

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /opt/
COPY package.json yarn.lock ./ 
RUN yarn config set network-timeout 600000 -g && yarn install --production=false

WORKDIR /opt/app
COPY . .
RUN yarn build

# --- ESTÁGIO 2: Runtime ---
FROM node:20-alpine
# Libvips é necessária para o processamento de imagens do Strapi 5
RUN apk add --no-cache vips-dev
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /opt/
COPY --from=build /opt/node_modules ./node_modules
WORKDIR /opt/app
COPY --from=build /opt/app ./

ENV PATH /opt/node_modules/.bin:$PATH

RUN chown -R node:node /opt/app
USER node

EXPOSE 1337
CMD ["yarn", "start"]