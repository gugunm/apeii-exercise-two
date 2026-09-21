const adminSecurity = [{ adminApiKey: [] }];

const unauthorized = {
  description: 'Missing or invalid admin key',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string', example: 'Unauthorized' } },
      },
    },
  },
};

const notFound = {
  description: 'Key not found',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string', example: 'Key not found' } },
      },
    },
  },
};

const keyEnvelope = {
  type: 'object',
  required: ['data'],
  properties: { data: { $ref: '#/components/schemas/ApiKey' } },
};

export const apiKeyOpenApi = {
  securitySchemes: {
    adminApiKey: {
      type: 'http',
      scheme: 'bearer',
      description:
        'Static admin key from the ADMIN_API_KEY environment variable.',
    },
  },
  paths: {
    '/admin/keys': {
      post: {
        tags: ['API Keys'],
        summary: 'Create an API key',
        description:
          'Creates a key and returns the plaintext secret **once**. Only the SHA-256 hash is stored; the secret cannot be retrieved again.',
        operationId: 'createApiKey',
        security: adminSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateApiKey' },
              example: {
                name: 'client-a',
                scopes: ['eseal:read', 'eseal:write'],
                expiresAt: null,
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Key created; response includes the one-time secret',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: { $ref: '#/components/schemas/ApiKeyWithSecret' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid body or unknown scope' },
          '401': unauthorized,
        },
      },
      get: {
        tags: ['API Keys'],
        summary: 'List API keys',
        description: 'Lists all keys without their secrets or hashes.',
        operationId: 'listApiKeys',
        security: adminSecurity,
        responses: {
          '200': {
            description: 'All keys',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ApiKey' },
                    },
                  },
                },
              },
            },
          },
          '401': unauthorized,
        },
      },
    },
    '/admin/keys/{id}': {
      get: {
        tags: ['API Keys'],
        summary: 'Get an API key',
        operationId: 'getApiKey',
        security: adminSecurity,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'API key ULID',
            schema: { $ref: '#/components/schemas/Ulid' },
          },
        ],
        responses: {
          '200': {
            description: 'The key',
            content: { 'application/json': { schema: keyEnvelope } },
          },
          '401': unauthorized,
          '404': notFound,
        },
      },
      patch: {
        tags: ['API Keys'],
        summary: 'Update an API key',
        description: 'Updates the name and/or scopes of a key.',
        operationId: 'updateApiKey',
        security: adminSecurity,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'API key ULID',
            schema: { $ref: '#/components/schemas/Ulid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateApiKey' },
              example: { scopes: ['eseal:read'] },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated key',
            content: { 'application/json': { schema: keyEnvelope } },
          },
          '400': { description: 'Invalid body or unknown scope' },
          '401': unauthorized,
          '404': notFound,
        },
      },
    },
    '/admin/keys/{id}/revoke': {
      post: {
        tags: ['API Keys'],
        summary: 'Revoke an API key',
        description:
          'Marks the key revoked. Revocation is immediate; the key fails on the next request.',
        operationId: 'revokeApiKey',
        security: adminSecurity,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'API key ULID',
            schema: { $ref: '#/components/schemas/Ulid' },
          },
        ],
        responses: {
          '200': {
            description: 'Revoked key',
            content: { 'application/json': { schema: keyEnvelope } },
          },
          '401': unauthorized,
          '404': notFound,
        },
      },
    },
    '/admin/keys/{id}/rotate': {
      post: {
        tags: ['API Keys'],
        summary: 'Rotate an API key',
        description:
          'Mints a new secret on the same key (id, name, scopes, expiry preserved) and invalidates the old secret immediately. The plaintext is returned **once**. Only active keys can be rotated.',
        operationId: 'rotateApiKey',
        security: adminSecurity,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'API key ULID',
            schema: { $ref: '#/components/schemas/Ulid' },
          },
        ],
        responses: {
          '200': {
            description: 'Rotated key with the new one-time secret',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: { $ref: '#/components/schemas/ApiKeyWithSecret' },
                  },
                },
              },
            },
          },
          '401': unauthorized,
          '404': notFound,
          '409': {
            description: 'Key is revoked or expired; rotation requires an active key',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['error'],
                  properties: {
                    error: {
                      type: 'string',
                      example: 'Key is not active; rotation requires an active key',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  schemas: {
    ApiKeyScopes: {
      type: 'array',
      description:
        'Grants shaped `resource:action`. Wildcards `resource:*` and `*` are accepted.',
      items: {
        type: 'string',
        example: 'eseal:read',
      },
      example: ['eseal:read', 'eseal:write'],
    },
    CreateApiKey: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'scopes'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 255 },
        scopes: { $ref: '#/components/schemas/ApiKeyScopes' },
        expiresAt: {
          type: 'string',
          format: 'date-time',
          nullable: true,
          description: 'Hard expiry; omit or null for a key that never expires',
        },
      },
    },
    UpdateApiKey: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 255 },
        scopes: { $ref: '#/components/schemas/ApiKeyScopes' },
      },
    },
    ApiKey: {
      type: 'object',
      required: [
        'id',
        'name',
        'prefix',
        'scopes',
        'status',
        'expiresAt',
        'lastUsedAt',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        id: { $ref: '#/components/schemas/Ulid' },
        name: { type: 'string', example: 'client-a' },
        prefix: {
          type: 'string',
          description: 'Display fragment; not enough to authenticate',
          example: 'seal_xE9TaV',
        },
        scopes: { $ref: '#/components/schemas/ApiKeyScopes' },
        status: {
          type: 'string',
          enum: ['active', 'revoked', 'expired'],
          example: 'active',
        },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
        lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    ApiKeyWithSecret: {
      allOf: [
        { $ref: '#/components/schemas/ApiKey' },
        {
          type: 'object',
          required: ['secret'],
          properties: {
            secret: {
              type: 'string',
              description: 'Plaintext key, shown only once',
              example: 'seal_xE9TaVKg6gLqN7bwCk2eB-8FAFa2p6fH6SgzE-kal4I',
            },
          },
        },
      ],
    },
  },
} as const;
