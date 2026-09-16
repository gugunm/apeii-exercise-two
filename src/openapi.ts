import { jobOpenApi } from './modules/doc-summary/docs.js';
import { esealOpenApi } from './modules/e-seal/docs.js';
// import { tteOpenApi } from './modules/tte/docs.js';

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'TTE AND E-SEAL API',
    version: '1.0.0',
  },
  servers: [{ url: 'http://localhost:3000' }],
  paths: {
    // ...tteOpenApi.paths,
    ...jobOpenApi.paths,
    ...esealOpenApi.paths,
  },
  components: {
    schemas: {
      // ...tteOpenApi.schemas,
      ...jobOpenApi.schemas,
      ...esealOpenApi.schemas,
    },
  },
} as const;
