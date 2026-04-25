import type { Core } from '@strapi/strapi';

const config: Core.Config.Middlewares = [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com', 'https://market-assets.strapi.io'],
          'media-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com', 'https://market-assets.strapi.io'],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      // Adicione aqui a URL do seu frontend em produção
      origin: [
        'http://localhost:5173', // Vite dev server (padrão)
        'http://localhost:3000', // fallback CRA / outro
        'https://behend.com.br',
        'https://bescore.vercel.app',
        process.env.FRONTEND_URL ?? '',
      ].filter(Boolean),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
      keepHeaderOnError: true,
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];

export default config;
