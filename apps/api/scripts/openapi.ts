import SwaggerParser from '@apidevtools/swagger-parser';
import { z } from 'zod';
import * as contracts from '@cupmemo/contracts';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020.js');
const addFormats = require('ajv-formats');
export function createSchemaValidator(document: Document, schema: Schema) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile({ ...schema, components: document.components });
}

// JSON Schema/OpenAPI objects are extensible recursive documents. Keep this
// dynamic boundary local; the pinned converter and validators check its shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Schema = Record<string, any>;
type ConversionDef = {
  type: string;
  in: z.ZodType;
  out: z.ZodType;
  checks?: { _zod: { def: { check: string } } }[];
};
type Document = {
  openapi: string;
  info: Schema;
  servers: Schema[];
  paths: Record<string, Schema>;
  components: Schema;
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: Schema) => ({ 'application/json': { schema } });
const object = (properties: Schema, required = Object.keys(properties), strict = true): Schema => ({
  type: 'object',
  properties,
  required,
  ...(strict ? { additionalProperties: false } : {}),
});
const string = { type: 'string' };
const date = { type: 'string', format: 'date-time' };
const nullableString = { type: ['string', 'null'] };
const privateHeaders = {
  'Cache-Control': {
    description: 'Private responses are not cacheable.',
    schema: { type: 'string', const: 'no-store' },
  },
  Vary: { description: 'Includes Cookie, preserving any other Vary values.', schema: string },
  'Set-Cookie': {
    description:
      'Optional targeted expired-session/stale-cookie cleanup only; application lookups do not renew valid sessions.',
    schema: string,
  },
};
const cookieHeader = {
  'Set-Cookie': {
    description:
      'Optional cookie issuance, sliding renewal or cleanup. HttpOnly; SameSite=Lax; Secure on production HTTPS. Values intentionally omitted.',
    schema: string,
  },
};
const protectedSecurity = [{ sessionCookie: [] }];
const optionalSecurity = [{}, ...protectedSecurity];
const domainPolicy =
  'Authenticated ownership in SQL. Foreign and absent IDs share 404; foreign coffee filters return an empty 200 page. Offset pagination is bounded, not a snapshot. Application session validation does not renew valid sessions; targeted expired-session deletion and stale-cookie cleanup are allowed. Unsafe methods require exact configured Origin and reject cross-site Sec-Fetch-Site before private work.';
const limitations =
  'Zod remains authoritative: text is trimmed before bounds (JavaScript UTF-16 code units), blanks in nullable text become null; descriptors/tags must be unique after trim and output sorted in UTF-16 order. Brew dates require valid calendar/time and years 0001..9999 after UTC conversion. Decimal spelling has at most two decimal places. Pours sum exactly in integer hundredths, are chronological and within duration; output positions are contiguous. PATCH omissions preserve stored values and merged-state recipe validation precedes writes. JSON Schema does not execute these refinements.';

// Decimal query strings can retain leading zeroes. Derive a finite upper-bound
// regex from the same output schema rather than duplicate query validators.
function decimalPattern(minimum: number, maximum: number) {
  const digits = String(maximum);
  const alternatives = [digits];
  if (digits.length > 1) alternatives.push(`[0-9]{1,${digits.length - 1}}`);
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[i]);
    if (digit > 0)
      alternatives.push(
        `${digits.slice(0, i)}[0-${digit - 1}]${i + 1 < digits.length ? `[0-9]{${digits.length - i - 1}}` : ''}`,
      );
  }
  return `^${minimum === 1 ? '(?!0+$)' : ''}0*(?:${alternatives.join('|')})$`;
}

export function projectSchema(schema: z.ZodType, io: 'input' | 'output'): Schema {
  const result: Schema = z.toJSONSchema(schema, {
    io,
    target: 'draft-2020-12',
    unrepresentable: 'throw',
    override: ({ zodSchema, jsonSchema }) => {
      const source = zodSchema as unknown as z.ZodType;
      const def = source._zod.def as unknown as ConversionDef;
      const output = jsonSchema as Schema;
      if (def.type === 'pipe' && def.out._zod.def.type !== 'transform') {
        const before = projectSchema(def.in, 'input');
        const after = projectSchema(def.out, 'output');
        if (before.type === 'number' && after.type === 'number')
          Object.assign(output, before, after);
        if (io === 'input' && before.type === 'string' && after.type === 'integer') {
          Object.assign(output, before, {
            pattern: decimalPattern(after.minimum, after.maximum),
            description: `Raw unsigned decimal string; range ${after.minimum}..${after.maximum}; repeated/array values rejected.`,
          });
        }
      }
      if (
        def.type === 'string' &&
        io === 'input' &&
        def.checks?.some((check) => check._zod.def.check === 'overwrite')
      ) {
        output['x-cupmemo-validation'] =
          `Trim before string bounds; minimum ${output.minLength ?? 0}, maximum ${output.maxLength ?? 'unbounded'} UTF-16 code units.`;
        // A long raw string with short trimmed content is valid. JSON Schema
        // cannot count post-trim UTF-16 units; never reject it using a raw max.
        delete output.maxLength;
      }
      if (
        source === contracts.brewSchema.shape.overallScore ||
        source === contracts.brewSchema.shape.acidity.unwrap()
      )
        output.multipleOf = 0.25;
      if (io === 'input' && source === contracts.brewCreateSchema.shape.brewedAt) {
        output.pattern =
          '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$';
      }
      if (def.checks?.some((check) => check._zod.def.check === 'custom'))
        output['x-cupmemo-validation'] = limitations;
    },
  });
  delete result.$schema;
  return result;
}

function domainComponents() {
  const schemas: Record<string, Schema> = {};
  for (const [exportName, schema] of Object.entries(contracts)) {
    if (!exportName.endsWith('Schema')) continue;
    const name = exportName[0]!.toUpperCase() + exportName.slice(1, -6);
    const input = /Create|Patch|ListQuery|Id/.test(name);
    schemas[name] = projectSchema(schema as z.ZodType, input ? 'input' : 'output');
    schemas[name].description =
      `${input ? 'Raw HTTP input' : 'Public HTTP output'} from @cupmemo/contracts.${exportName}. ${limitations}`;
    schemas[name]['x-cupmemo-validation'] = limitations;
    if (name.endsWith('Patch')) schemas[name].minProperties = 1;
  }
  schemas.Pagination = projectSchema(contracts.coffeeListResponseSchema.shape.pagination, 'output');
  for (const [name, field, collection] of [
    ['Coffee', 'coffee', 'coffees'],
    ['Brew', 'brew', 'brews'],
  ]) {
    schemas[`${name}Response`].properties[field] = ref(name);
    schemas[`${name}ListResponse`].properties[collection].items = ref(name);
    schemas[`${name}ListResponse`].properties.pagination = ref('Pagination');
  }
  return schemas;
}

// Narrow pinned Better Auth 1.7.7 wire mirror. Metadata contains inaccurate
// sign-in redirect:false and image URI constraints; handler/source + real HTTP
// parity are authoritative. No library plugin or auth instance is constructed.
function authComponents() {
  const user = object(
    {
      id: string,
      name: string,
      email: { ...string, format: 'email' },
      emailVerified: { type: 'boolean' },
      image: nullableString,
      createdAt: date,
      updatedAt: date,
    },
    ['id', 'name', 'email', 'emailVerified', 'createdAt', 'updatedAt'],
  );
  const session = object(
    {
      id: string,
      userId: string,
      token: {
        ...string,
        description:
          'Public library session credential shape only; never log or save response values.',
      },
      expiresAt: date,
      createdAt: date,
      updatedAt: date,
      ipAddress: nullableString,
      userAgent: nullableString,
    },
    ['id', 'userId', 'token', 'expiresAt', 'createdAt', 'updatedAt'],
  );
  return {
    AuthUser: {
      ...user,
      description:
        'Pinned library public user projection; not a domain owner/storage representation.',
    },
    AuthSession: {
      ...session,
      description:
        'Pinned library public session projection; credentials are deliberately never exemplified.',
    },
    AuthSignup: object(
      {
        name: string,
        email: { ...string, format: 'email' },
        password: { ...string, minLength: 8, maxLength: 128, writeOnly: true },
        image: string,
        callbackURL: string,
        rememberMe: { type: 'boolean', default: true },
      },
      ['name', 'email', 'password'],
      false,
    ),
    AuthSignin: object(
      {
        email: { ...string, format: 'email' },
        password: { ...string, maxLength: 128, writeOnly: true },
        callbackURL: string,
        rememberMe: { type: 'boolean', default: true },
      },
      ['email', 'password'],
      false,
    ),
    AuthSignout: object(
      { callbackURL: string, disableRedirect: { type: 'boolean' }, state: string },
      [],
      false,
    ),
    AuthSignupResponse: object({ token: nullableString, user: ref('AuthUser') }),
    AuthSigninResponse: object(
      { redirect: { type: 'boolean' }, token: string, url: string, user: ref('AuthUser') },
      ['redirect', 'token', 'user'],
    ),
    AuthGetSessionResponse: {
      anyOf: [object({ session: ref('AuthSession'), user: ref('AuthUser') }), { type: 'null' }],
    },
    AuthSignoutResponse: object({ success: { type: 'boolean', const: true } }),
    AuthError: object({ code: string, message: string }, ['message'], false),
    AuthBridgeError: object({ message: { ...string, const: 'Authentication request failed' } }),
  };
}

export function buildDocument(): Document {
  const schemas: Record<string, Schema> = {
    ...domainComponents(),
    ...authComponents(),
    Health: object({ status: { ...string, const: 'ok' } }),
    Me: object({
      user: object({ id: string, name: string, email: { ...string, format: 'email' } }),
    }),
  };
  const paths: Document['paths'] = {};
  const response = (description: string, schema: Schema, headers: Schema = privateHeaders) => ({
    description,
    headers,
    content: json(schema),
  });
  const error = (message: string | string[]) =>
    object({
      message: {
        type: 'string',
        ...(Array.isArray(message) ? { enum: message } : { const: message }),
      },
    });
  for (const [resource, name] of [
    ['coffees', 'Coffee'],
    ['brews', 'Brew'],
  ]) {
    for (const [method, item, success, body, output] of [
      ['post', false, '201', 'Create', 'Response'],
      ['get', false, '200', '', 'ListResponse'],
      ['get', true, '200', '', 'Response'],
      ['patch', true, '200', 'Patch', 'Response'],
      ['delete', true, '204', '', ''],
    ] as const) {
      const parameters: Schema[] = item
        ? [{ name: 'id', in: 'path', required: true, schema: ref(`${name}Id`) }]
        : [];
      if (['post', 'patch', 'delete'].includes(method))
        parameters.push({
          name: 'Origin',
          in: 'header',
          required: true,
          description:
            'Exact configured application origin; no hardcoded deployment origin. Cross-site Sec-Fetch-Site is also rejected.',
          schema: string,
        });
      if (method === 'get' && !item) {
        for (const [field, schema] of Object.entries(schemas[`${name}ListQuery`].properties))
          parameters.push({
            name: field,
            in: 'query',
            required: false,
            schema,
            description:
              'Only declared query keys accepted; repeated values and arrays rejected. Offset pagination is not a snapshot.',
          });
      }
      const responses: Schema = {
        [success]:
          success === '204'
            ? { description: 'Deleted; empty body.', headers: privateHeaders }
            : response('Success', ref(`${name}${output}`)),
        '400': response(
          'Invalid input or parser failure.',
          error(`Invalid ${name.toLowerCase()} request`),
        ),
        '401': response(
          'Missing, expired, invalid or revoked session.',
          error('Authentication required'),
        ),
        '403': response(
          'Unsafe origin denied before private work.',
          error('Request origin not allowed'),
        ),
        '404': response('Foreign and absent IDs indistinguishable.', error('Resource not found')),
        '413': response('Request body too large.', error(`Invalid ${name.toLowerCase()} request`)),
        '415': response('Unsupported media type.', error(`Invalid ${name.toLowerCase()} request`)),
        '503': response(
          'Authority dependency or domain/DB/output failure.',
          error(['Authentication unavailable', `${name} service unavailable`]),
        ),
      };
      if (resource === 'coffees' && method === 'delete')
        responses['409'] = response(
          'Saved brews prevent coffee deletion.',
          error('Coffee has saved brews'),
        );
      if (method === 'get') delete responses['403'];
      if (!item && !(resource === 'brews' && method === 'post')) delete responses['404'];
      const path = `/api/v1/${resource}${item ? '/{id}' : ''}`;
      paths[path] ??= {};
      paths[path][method] = {
        operationId: `${method}${name}${!item && method === 'get' ? 'List' : ''}`,
        description: domainPolicy + ' ' + limitations,
        security: protectedSecurity,
        parameters,
        responses,
        ...(body ? { requestBody: { required: true, content: json(ref(`${name}${body}`)) } } : {}),
      };
    }
  }
  paths['/api/v1/health'] = {
    get: {
      operationId: 'getHealth',
      description: 'Public database-independent liveness.',
      security: [],
      responses: { '200': response('Healthy', ref('Health'), {}) },
    },
  };
  paths['/api/v1/me'] = {
    get: {
      operationId: 'getMe',
      description: domainPolicy,
      security: protectedSecurity,
      responses: {
        '200': response('Authenticated principal only.', ref('Me')),
        '401': response('Unauthenticated', error('Authentication required')),
        '503': response('Authority unavailable', error('Authentication unavailable')),
      },
    },
  };
  for (const [path, method, input, output, statuses] of [
    [
      'sign-up/email',
      'post',
      'AuthSignup',
      'AuthSignupResponse',
      ['400', '403', '422', '429', '500'],
    ],
    [
      'sign-in/email',
      'post',
      'AuthSignin',
      'AuthSigninResponse',
      ['400', '401', '403', '429', '500'],
    ],
    ['sign-out', 'post', 'AuthSignout', 'AuthSignoutResponse', ['400', '403', '429', '500']],
    ['get-session', 'get', '', 'AuthGetSessionResponse', ['400', '401', '429', '500']],
  ] as const) {
    const responses: Schema = {
      '200': response(
        'Pinned Better Auth success; get-session without valid credentials returns null. Set-Cookie may issue, renew or clear cookies.',
        ref(output),
        {
          ...cookieHeader,
          ...(method === 'get'
            ? {
                'Cache-Control': {
                  schema: { ...string, const: 'no-store' },
                  description: 'Session lookup is not cacheable.',
                },
              }
            : {}),
        },
      ),
    };
    for (const status of statuses)
      responses[status] = response(
        'Pinned library error; code may be absent. Catalog is not exhaustive. 500 may instead be the Fastify bridge error.',
        status === '500' ? { anyOf: [ref('AuthError'), ref('AuthBridgeError')] } : ref('AuthError'),
        cookieHeader,
      );
    paths[`/api/v1/auth/${path}`] = {
      [method]: {
        operationId: `${method}${output}`,
        security: ['sign-out', 'get-session'].includes(path) ? optionalSecurity : [],
        description:
          'Better Auth 1.7.7 email/password transport, narrowly mirrored from endpoint handlers/metadata. Signup/signin form CSRF validates Origin/Referer when cookies or browser Fetch Metadata or Origin/Referer are supplied; cross-site navigation login rejected. Signout is optional-session: cookies trigger library Origin/Referer validation, absent cookies do not require Origin; invalid/absent sessions still clear cookies and return success. Callback URLs must be trusted. This is not the domain unconditional Origin guard. get-session supports browser sliding renewal (7-day expiry, 1-day update age); expired/stale cleanup remains possible with disableRefresh.',
        ...(input
          ? { requestBody: { required: path !== 'sign-out', content: json(ref(input)) } }
          : {
              parameters: ['disableRefresh', 'disableCookieCache'].map((name) => ({
                name,
                in: 'query',
                required: false,
                schema: { type: 'string' },
                description:
                  'Pinned z.coerce.boolean query flag: any nonempty string (including false) is truthy; omit for false.',
              })),
            }),
        responses,
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'CupMemo v1 API', version: '1.0.0' },
    servers: [{ url: '/' }],
    paths,
    components: {
      schemas,
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description:
            'Same-origin browser credentials: include. HttpOnly signed session cookie, not Bearer/JWT. Production HTTPS uses __Secure-better-auth.session_token instead: an alternate name, not two jointly required cookies.',
        },
      },
    },
  };
}

export async function validateDocument(document: Document) {
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref') {
        if (typeof child !== 'string' || !child.startsWith('#/'))
          throw new Error('Only local refs allowed');
        let resolved: unknown = document;
        for (const part of child.slice(2).split('/'))
          resolved = (resolved as Schema)?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
        if (!resolved) throw new Error('Unresolved local ref');
      } else visit(child);
    }
  };
  visit(document);
  for (const schema of Object.values(document.components.schemas))
    createSchemaValidator(document, schema as Schema);
  // Disable external resolution: validation must never perform network I/O.
  await SwaggerParser.validate(structuredClone(document) as SwaggerParser['api'], {
    resolve: { external: false },
  });
  const expected = buildDocument();
  const ids = new Set<string>();
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!expected.paths[path]?.[method] || ids.has(operation.operationId))
        throw new Error('Invalid route inventory or operationId');
      const authoritative = expected.paths[path][method];
      if (JSON.stringify(operation.security) !== JSON.stringify(authoritative.security))
        throw new Error('Security policy drifted');
      if (
        JSON.stringify(Object.keys(operation.responses).sort()) !==
        JSON.stringify(Object.keys(authoritative.responses).sort())
      )
        throw new Error('Response statuses drifted');
      ids.add(operation.operationId);
      for (const requirement of operation.security ?? [])
        for (const name of Object.keys(requirement))
          if (!document.components.securitySchemes[name])
            throw new Error('Unknown security scheme');
      if (operation.responses['204']?.content !== undefined)
        throw new Error('204 must have no content');
    }
  }
  if (ids.size !== 16) throw new Error('Missing route');
  for (const [name, schema] of Object.entries(expected.components.schemas) as [string, Schema][]) {
    if (
      JSON.stringify(document.components.schemas[name]?.required) !==
      JSON.stringify(schema.required)
    )
      throw new Error('Required schema fields drifted');
  }
}

export const artifact = new URL('../../../docs/openapi.json', import.meta.url);
export const serializeDocument = (document: Document) => JSON.stringify(document, null, 2) + '\n';
export async function checkArtifact(path: URL = artifact) {
  const document = buildDocument();
  await validateDocument(document);
  if ((await readFile(path, 'utf8')) !== serializeDocument(document))
    throw new Error('OpenAPI artifact is stale; run api:openapi:generate');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = process.argv[2];
    if (command === 'generate') {
      const document = buildDocument();
      await validateDocument(document);
      await writeFile(artifact, serializeDocument(document));
    } else if (command === 'check') await checkArtifact();
    else throw new Error('Expected generate or check');
    process.stdout.write('Offline OpenAPI validation/freshness passed.\n');
  } catch {
    process.stderr.write('Offline OpenAPI generation/check failed.\n');
    process.exitCode = 1;
  }
}
