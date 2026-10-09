const BatchStatus = {
  type: 'string',
  enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
} as const;

const BatchStep = {
  type: 'string',
  enum: [
    'QUEUED',
    'DOWNLOADING',
    'SEALING',
    'UPLOADING',
    'COMPLETED',
    'FAILED',
  ],
} as const;

const apiSecurity = [{ apiKey: [] }];

const unauthorized = {
  description: 'Missing or invalid API key',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string', example: 'Unauthorized' } },
      },
    },
  },
} as const;

const forbidden = {
  description: 'API key lacks the required scope',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'string', example: 'Forbidden' },
          missingScope: { type: 'string', example: 'eseal:write' },
        },
      },
    },
  },
} as const;

export const esealOpenApi = {
  securitySchemes: {
    apiKey: {
      type: 'http',
      scheme: 'bearer',
      description:
        'API key issued via POST /admin/keys. Send as `Authorization: Bearer <key>`. The key must hold the scope noted on each operation.',
    },
  },
  paths: {
    '/api/v1/e-seal': {
      post: {
        tags: ['E-Seal'],
        summary: 'Upload PDFs and queue them for BSrE e-seal',
        operationId: 'createEsealBatch',
        security: apiSecurity,
        description:
          'Requires scope `eseal:write`.\n\n' +
          'With `tampilan=VISIBLE`, `imageBase64` is required: the seal image is sent by the caller as a plain base64 string (no `data:` prefix). The API stores it in S3 and the worker forwards it to BSrE as `imageBase64` in `signatureProperties`.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: { $ref: '#/components/schemas/CreateEsealBatch' },
            },
          },
        },
        responses: {
          '202': {
            description: 'Batch accepted and queued with PENDING status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: { $ref: '#/components/schemas/EsealBatchCreated' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid form data' },
          '401': unauthorized,
          '403': forbidden,
        },
      },
      get: {
        tags: ['E-Seal'],
        summary: 'List e-seal batches',
        operationId: 'listEsealBatches',
        security: apiSecurity,
        description: 'Requires scope `eseal:read`.',
        responses: {
          '200': {
            description: 'Batches ordered by creation time, newest first',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/EsealBatch' },
                    },
                  },
                },
              },
            },
          },
          '401': unauthorized,
          '403': forbidden,
        },
      },
    },
    '/api/v1/e-seal/{id}': {
      get: {
        tags: ['E-Seal'],
        summary: 'Get an e-seal batch with files, download URLs and logs',
        operationId: 'getEsealBatch',
        security: apiSecurity,
        description: 'Requires scope `eseal:read`.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Batch ULID',
            schema: { $ref: '#/components/schemas/Ulid' },
          },
        ],
        responses: {
          '200': {
            description:
              'Batch detail. downloadUrl is a presigned S3 URL, null until COMPLETED.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: { $ref: '#/components/schemas/EsealBatchDetail' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Batch not found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['error'],
                  properties: {
                    error: { type: 'string', example: 'Batch not found' },
                  },
                },
              },
            },
          },
          '401': unauthorized,
          '403': forbidden,
        },
      },
    },
    '/api/v1/e-seal/{id}/files': {
      get: {
        tags: ['E-Seal'],
        summary: 'List files of a batch with view/download paths',
        operationId: 'listEsealBatchFiles',
        security: apiSecurity,
        description: 'Requires scope `eseal:read`.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Batch ULID',
            schema: { $ref: '#/components/schemas/Ulid' },
          },
        ],
        responses: {
          '200': {
            description: 'Files ordered by upload position',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/EsealFileLink' },
                    },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Batch not found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['error'],
                  properties: {
                    error: { type: 'string', example: 'Batch not found' },
                  },
                },
              },
            },
          },
          '401': unauthorized,
          '403': forbidden,
        },
      },
    },
    '/api/v1/e-seal/{id}/files/{fileId}/{kind}': {
      get: {
        tags: ['E-Seal'],
        summary: 'View or download a raw or sealed PDF',
        operationId: 'getEsealFile',
        security: apiSecurity,
        description: 'Requires scope `eseal:read`.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Batch ULID',
            schema: { $ref: '#/components/schemas/Ulid' },
          },
          {
            name: 'fileId',
            in: 'path',
            required: true,
            description: 'File ULID (from batch detail `files[].id`)',
            schema: { $ref: '#/components/schemas/Ulid' },
          },
          {
            name: 'kind',
            in: 'path',
            required: true,
            description: '`raw` = as uploaded, `verified` = sealed by BSrE',
            schema: { type: 'string', enum: ['raw', 'verified'] },
          },
          {
            name: 'download',
            in: 'query',
            required: false,
            description:
              'Any value forces Content-Disposition: attachment; omit to view inline',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'PDF bytes',
            content: {
              'application/pdf': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          '404': {
            description:
              'File not in this batch, or verified copy not ready yet',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['error'],
                  properties: {
                    error: { type: 'string', example: 'File not found' },
                  },
                },
              },
            },
          },
          '401': unauthorized,
          '403': forbidden,
        },
      },
    },
  },
  schemas: {
    Ulid: {
      type: 'string',
      minLength: 26,
      maxLength: 26,
      pattern: '^[0-9A-HJKMNP-TV-Z]{26}$',
      example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    },
    CreateEsealBatch: {
      type: 'object',
      required: ['files[]', 'userId', 'tampilan'],
      properties: {
        'files[]': {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'PDF files, 1..ESEAL_MAX_FILES',
        },
        userId: { type: 'string' },
        tampilan: {
          type: 'string',
          enum: ['INVISIBLE', 'VISIBLE'],
          description:
            'VISIBLE requires `page`, `originX`, `originY`, `width`, `height`, `location` and `imageBase64`.',
        },
        page: {
          type: 'integer',
          minimum: 1,
          description: 'Required when tampilan=VISIBLE',
        },
        originX: { type: 'number', description: 'Required when tampilan=VISIBLE' },
        originY: { type: 'number', description: 'Required when tampilan=VISIBLE' },
        width: { type: 'number', description: 'Required when tampilan=VISIBLE' },
        height: { type: 'number', description: 'Required when tampilan=VISIBLE' },
        location: {
          type: 'string',
          description: 'Required when tampilan=VISIBLE',
        },
        imageBase64: {
          type: 'string',
          description:
            'Required when tampilan=VISIBLE. Seal image as plain base64, no `data:` prefix.',
        },
        reason: { type: 'string', default: 'null' },
      },
    },
    EsealBatchCreated: {
      type: 'object',
      required: ['id', 'status', 'totalFiles', 'statusUrl'],
      properties: {
        id: { $ref: '#/components/schemas/Ulid' },
        status: { type: 'string', enum: ['PENDING'] },
        totalFiles: { type: 'integer' },
        statusUrl: {
          type: 'string',
          example: '/api/v1/e-seal/01ARZ3NDEKTSV4RRFFQ69G5FAV',
        },
      },
    },
    EsealSealConfig: {
      type: 'object',
      required: ['tampilan', 'reason'],
      properties: {
        tampilan: { type: 'string', enum: ['INVISIBLE', 'VISIBLE'] },
        reason: { type: 'string' },
        page: { type: 'integer' },
        originX: { type: 'number' },
        originY: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        location: { type: 'string' },
        imageKey: {
          type: 'string',
          description: 'S3 key of the stored seal image (VISIBLE only)',
        },
      },
    },
    EsealBatch: {
      type: 'object',
      required: [
        'id',
        'userId',
        'status',
        'currentStep',
        'sealConfig',
        'error',
        'startedAt',
        'finishedAt',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        id: { $ref: '#/components/schemas/Ulid' },
        userId: { type: 'string' },
        status: BatchStatus,
        currentStep: BatchStep,
        sealConfig: { $ref: '#/components/schemas/EsealSealConfig' },
        error: { type: 'string', nullable: true },
        startedAt: { type: 'string', format: 'date-time', nullable: true },
        finishedAt: { type: 'string', format: 'date-time', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    EsealFile: {
      type: 'object',
      required: ['id', 'filename', 'fileSize', 'downloadUrl'],
      properties: {
        id: { $ref: '#/components/schemas/Ulid' },
        filename: { type: 'string' },
        fileSize: { type: 'integer' },
        downloadUrl: { type: 'string', nullable: true },
      },
    },
    EsealFileLink: {
      type: 'object',
      required: ['id', 'filename', 'fileSize', 'rawUrl', 'verifiedUrl'],
      properties: {
        id: { $ref: '#/components/schemas/Ulid' },
        filename: { type: 'string' },
        fileSize: { type: 'integer' },
        rawUrl: {
          type: 'string',
          example: '/api/v1/e-seal/01ARZ3NDEKTSV4RRFFQ69G5FAV/files/01ARZ3NDEKTSV4RRFFQ69G5FAW/raw',
        },
        verifiedUrl: {
          type: 'string',
          nullable: true,
          description: 'null until the batch is COMPLETED',
        },
      },
    },
    EsealLog: {
      type: 'object',
      required: ['level', 'step', 'message', 'meta', 'createdAt'],
      properties: {
        level: { type: 'string', enum: ['INFO', 'ERROR'] },
        step: BatchStep,
        message: { type: 'string' },
        meta: { type: 'object', nullable: true, additionalProperties: true },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
    EsealBatchDetail: {
      allOf: [
        { $ref: '#/components/schemas/EsealBatch' },
        {
          type: 'object',
          required: ['files', 'logs'],
          properties: {
            files: {
              type: 'array',
              items: { $ref: '#/components/schemas/EsealFile' },
            },
            logs: {
              type: 'array',
              items: { $ref: '#/components/schemas/EsealLog' },
            },
          },
        },
      ],
    },
  },
} as const;
