export const jobOpenApi = {
  paths: {
    '/api/v1/doc-summary': {
      post: {
        tags: ['Document Summary'],
        summary: 'Queue a document for summarization',
        operationId: 'createDocumentSummaryJob',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateDocSummaryJob' },
              example: {
                content:
                  'Artificial intelligence helps automate repetitive work.',
              },
            },
          },
        },
        responses: {
          '202': {
            description: 'Job accepted and queued with PENDING status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: { $ref: '#/components/schemas/DocSummaryJob' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid request body' },
        },
      },
      get: {
        tags: ['Document Summary'],
        summary: 'List document-summary jobs',
        operationId: 'listDocumentSummaryJobs',
        responses: {
          '200': {
            description: 'Jobs ordered by creation time, newest first',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/DocSummaryJob' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/doc-summary/{id}': {
      get: {
        tags: ['Document Summary'],
        summary: 'Get a document-summary job and its result',
        operationId: 'getDocumentSummaryJob',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Document-summary job ULID',
            schema: { $ref: '#/components/schemas/Ulid' },
          },
        ],
        responses: {
          '200': {
            description: 'Job and its result, or null while not completed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: {
                      $ref: '#/components/schemas/DocSummaryJobWithResult',
                    },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Job not found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['error'],
                  properties: {
                    error: { type: 'string', example: 'Job not found' },
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
    Ulid: {
      type: 'string',
      minLength: 26,
      maxLength: 26,
      pattern: '^[0-9A-HJKMNP-TV-Z]{26}$',
      example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    },
    CreateDocSummaryJob: {
      type: 'object',
      additionalProperties: false,
      required: ['content'],
      properties: {
        content: {
          type: 'string',
          minLength: 1,
          description: 'Raw document text to summarize',
        },
      },
    },
    DocSummaryJob: {
      type: 'object',
      required: [
        'id',
        'content',
        'status',
        'error',
        'startedAt',
        'finishedAt',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        id: { $ref: '#/components/schemas/Ulid' },
        content: { type: 'string' },
        status: {
          type: 'string',
          enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
        },
        error: { type: 'string', nullable: true },
        startedAt: { type: 'string', format: 'date-time', nullable: true },
        finishedAt: { type: 'string', format: 'date-time', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    DocSummaryResult: {
      type: 'object',
      required: [
        'id',
        'jobId',
        'content_title',
        'content_summary',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        id: { $ref: '#/components/schemas/Ulid' },
        jobId: { $ref: '#/components/schemas/Ulid' },
        content_title: { type: 'string', maxLength: 255 },
        content_summary: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    DocSummaryJobWithResult: {
      allOf: [
        { $ref: '#/components/schemas/DocSummaryJob' },
        {
          type: 'object',
          required: ['result'],
          properties: {
            result: {
              nullable: true,
              allOf: [{ $ref: '#/components/schemas/DocSummaryResult' }],
            },
          },
        },
      ],
    },
  },
} as const;
