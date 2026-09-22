// import { jobOpenApi } from './modules/doc-summary/docs.js';
import { esealOpenApi } from './modules/e-seal/docs.js';
import { apiKeyOpenApi } from './modules/api-key/docs.js';

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'TTE AND E-SEAL API',
    version: '1.0.0',
  },
  // Relative URL: Scalar targets the same origin the docs are served from
  // (server IP:port, domain, or localhost) instead of a hardcoded host.
  servers: [{ url: '/' }],
  paths: {
    // ...jobOpenApi.paths,
    ...esealOpenApi.paths,
    ...apiKeyOpenApi.paths,
  },
  components: {
    securitySchemes: {
      ...esealOpenApi.securitySchemes,
      ...apiKeyOpenApi.securitySchemes,
    },
    schemas: {
      // ...jobOpenApi.schemas,
      ...esealOpenApi.schemas,
      ...apiKeyOpenApi.schemas,
    },
  },
} as const;
