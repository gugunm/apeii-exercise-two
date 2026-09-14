export const jobOpenApi = {
  paths: {
    '/api/v1/jobs': {
      get: {
        summary: 'List doc summary jobs',
        responses: {
          '200': {
            description: 'Jobs ordered by createdAt desc',
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
      post: {
        summary: 'Queue a document for summarization',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateDocSummaryJob' },
            },
          },
        },
        responses: {
          '202': {
            description: 'Job accepted and queued (status PENDING)',
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
    },
    '/api/v1/jobs/{id}': {
      get: {
        summary: 'Get a doc summary job with its result',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Job and its result (null until COMPLETED)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: { $ref: '#/components/schemas/DocSummaryJobWithResult' },
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
    CreateDocSummaryJob: {
      type: 'object',
      required: ['filename', 'content'],
      properties: {
        filename: { type: 'string', maxLength: 255, example: 'contract.txt' },
        mimeType: {
          type: 'string',
          maxLength: 100,
          default: 'text/plain',
          example: 'text/plain',
        },
        content: {
          type: 'string',
          description: 'Raw document text to summarize',
        },
      },
    },
    DocSummaryJob: {
      type: 'object',
      required: [
        'id',
        'filename',
        'mimeType',
        'fileSize',
        'status',
        'error',
        'startedAt',
        'finishedAt',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        filename: { type: 'string' },
        mimeType: { type: 'string' },
        fileSize: { type: 'integer', description: 'Bytes of content' },
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
      required: ['id', 'jobId', 'title', 'content', 'summary', 'createdAt', 'updatedAt'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        jobId: { type: 'string', format: 'uuid' },
        title: { type: 'string' },
        content: { type: 'string', description: 'Original document text' },
        summary: { type: 'string' },
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
