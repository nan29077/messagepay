import { API_BASE_PATH } from './index';
import { orderedCategories } from './registry';
import type { ApiEndpoint } from './types';

/**
 * OpenAPI 3.1 문서 생성.
 *
 * 손으로 쓰지 않고 레지스트리에서 만든다. 문서 화면과 같은 값을 읽으므로
 * 화면과 규격 파일이 어긋날 수 없다. 새 엔드포인트를 레지스트리에 등록하면
 * 여기에도 자동으로 올라온다.
 *
 * 준비 중(PLANNED) 항목도 포함하되 `deprecated` 가 아니라 설명 첫 줄에 명시한다.
 * 빼 버리면 가맹점이 "문서에는 있는데 규격 파일에는 없다"고 혼란스러워한다.
 */
export function buildOpenApiDocument(baseUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const category of orderedCategories()) {
    for (const endpoint of category.endpoints ?? []) {
      const path = `${API_BASE_PATH}${endpoint.path}`;
      paths[path] ??= {};
      paths[path][endpoint.method.toLowerCase()] = operationOf(category.title, endpoint);
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: '메시지페이 가맹점 API',
      version: '1.0.0',
      description:
        '가맹점 사이트에 메시지페이를 연동하는 API 입니다. ' +
        '상태가 "준비 중"인 항목은 아직 호출되지 않으며 규격이 바뀔 수 있습니다.',
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Authorization: Bearer {API 키}' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', example: false },
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

function operationOf(categoryTitle: string, endpoint: ApiEndpoint) {
  const statusLine =
    endpoint.status === 'LIVE'
      ? ''
      : endpoint.status === 'BETA'
        ? '[베타] 규격이 바뀔 수 있습니다. '
        : '[준비 중] 아직 제공되지 않습니다. 규격은 예고이며 바뀔 수 있습니다. ';

  const parameters = (endpoint.params ?? [])
    .filter((p) => p.in !== 'body')
    .map((p) => ({
      name: p.name,
      in: p.in === 'header' ? 'header' : p.in,
      required: Boolean(p.required) || p.in === 'path',
      description: p.description,
      schema: { type: p.type === 'number' ? 'integer' : 'string' },
      ...(p.example ? { example: p.example } : {}),
    }));

  const bodyParams = (endpoint.params ?? []).filter((p) => p.in === 'body');
  const requestBody =
    bodyParams.length > 0
      ? {
          required: bodyParams.some((p) => p.required),
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: bodyParams.filter((p) => p.required).map((p) => p.name),
                properties: Object.fromEntries(
                  bodyParams.map((p) => [
                    p.name,
                    {
                      type: p.type === 'number' ? 'integer' : p.type === 'object' ? 'object' : p.type === 'string[]' ? 'array' : 'string',
                      description: p.description,
                    },
                  ]),
                ),
              },
            },
          },
        }
      : undefined;

  return {
    tags: [categoryTitle],
    summary: endpoint.summary,
    description: [statusLine + (endpoint.description ?? ''), ...(endpoint.notes ?? [])].filter(Boolean).join('\n\n'),
    operationId: `${endpoint.method.toLowerCase()}${endpoint.path.replace(/[^A-Za-z0-9]+/g, '_')}`,
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: {
      '200': {
        description: '성공',
        ...(endpoint.responseExample
          ? { content: { 'application/json': { example: safeParse(endpoint.responseExample) } } }
          : {}),
      },
      '400': { description: '요청 오류', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      '401': { description: '인증 실패', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    },
    ...(endpoint.signed ? { 'x-signature-required': true } : {}),
    ...(endpoint.sandboxOnly ? { 'x-sandbox-only': true } : {}),
    'x-status': endpoint.status,
  };
}

/** 예시 문자열이 JSON 이 아니어도 문서 생성이 멈추지 않게 한다. */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
