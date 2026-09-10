export const tteOpenApi = {
  paths: {
    '/api/tte': {
      get: {
        summary: 'List TTE records',
        responses: {
          '200': {
            description: 'TTE records',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Tte' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/tte/{id}': {
      get: {
        summary: 'Get a TTE record',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'TTE record',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['data'],
                  properties: {
                    data: { $ref: '#/components/schemas/Tte' },
                  },
                },
              },
            },
          },
          '404': { description: 'TTE not found' },
        },
      },
    },
  },
  schemas: {
    Tte: {
      type: 'object',
      required: ['id', 'status', 'label'],
      properties: {
        id: { type: 'string', example: 'tte-001' },
        status: { type: 'string', enum: ['active', 'inactive'] },
        label: { type: 'string', example: 'Primary TTE' },
      },
    },
  },
} as const;
