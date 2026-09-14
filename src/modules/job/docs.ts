export const jobOpenApi = {
  paths: {
    '/api/v1/jobs': {
      get: {
        summary: 'List doc summary jobs',
        responses: {
          '200': {
            description: 'Doc summary jobs',
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
            description: 'Job accepted and queued',
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
          '400': { description: 'Invalid body' },
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
            description: 'Doc summary job',
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
          '404': { description: 'Job not found' },
        },
      },
    },
  },
  schemas: {
    CreateDocSummaryJob: {
      type: 'object',
      required: ['filename', 'content'],
      properties: {
        filename: { type: 'string', example: 'contract.txt' },
        mimeType: { type: 'string', default: 'text/plain' },
        content: { type: 'string', description: 'Raw document text' },
      },
    },
    DocSummaryJob: {
      type: 'object',
      required: ['id', 'filename', 'mimeType', 'fileSize', 'status'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        filename: { type: 'string' },
        mimeType: { type: 'string' },
        fileSize: { type: 'integer' },
        status: {
          type: 'string',
          enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
        },
        error: { type: 'string', nullable: true },
        startedAt: { type: 'string', format: 'date-time', nullable: true },
        finishedAt: { type: 'string', format: 'date-time', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        result: {
          nullable: true,
          $ref: '#/components/schemas/DocSummaryResult',
        },
      },
    },
    DocSummaryResult: {
      type: 'object',
      required: ['id', 'jobId', 'title', 'content', 'summary'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        jobId: { type: 'string', format: 'uuid' },
        title: { type: 'string' },
        content: { type: 'string' },
        summary: { type: 'string' },
      },
    },
  },
} as const;
