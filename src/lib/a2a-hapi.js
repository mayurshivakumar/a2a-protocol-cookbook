import { once } from 'node:events'
import { PassThrough } from 'node:stream'

import {
  A2A_VERSION_HEADER,
  AGENT_CARD_PATH,
  AgentCard,
  Extensions,
  HTTP_EXTENSION_HEADER,
  SSE_HEADERS,
  formatSSEErrorEvent,
  formatSSEEvent,
} from '@a2a-js/sdk'
import { ContentTypeNotSupportedError } from '@a2a-js/sdk/errors'
import { A2A_ERROR_CODE } from '@a2a-js/sdk/errors'
import {
  JsonRpcTransportHandler,
  UnauthenticatedUser,
  defaultServerCallContextBuilder,
  validateVersion,
} from '@a2a-js/sdk/server'

const JSON_CONTENT_TYPE = 'application/json'

function header(request, name) {
  return request.headers[name.toLowerCase()]
}

function isAsyncIterable(value) {
  return typeof value?.[Symbol.asyncIterator] === 'function'
}

function jsonRpcError(requestBody, error) {
  return {
    jsonrpc: '2.0',
    id: requestBody?.id ?? null,
    error: JsonRpcTransportHandler.mapToJSONRPCError(error),
  }
}

function applyActivatedExtensions(response, context) {
  if (context.activatedExtensions?.length) {
    response.header(HTTP_EXTENSION_HEADER, [...context.activatedExtensions].join(','))
  }
  return response
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await once(stream, 'drain')
  }
}

async function pumpSse({ output, iterator, firstResult, requestBody }) {
  try {
    if (!firstResult.done) {
      await writeChunk(output, formatSSEEvent(firstResult.value))
    }

    while (!output.destroyed) {
      const result = await iterator.next()
      if (result.done) {
        break
      }
      await writeChunk(output, formatSSEEvent(result.value))
    }
  } catch (error) {
    if (!output.destroyed) {
      await writeChunk(output, formatSSEErrorEvent(jsonRpcError(requestBody, error)))
    }
  } finally {
    output.end()
    await iterator.return?.()
  }
}

/**
 * Register an A2A v1.0 Agent Card and JSON-RPC endpoint on a Hapi server.
 *
 * The official SDK keeps protocol dispatch framework-neutral through
 * JsonRpcTransportHandler. This adapter supplies only the Hapi request/response
 * boundary; DefaultRequestHandler continues to own task and event semantics.
 */
export function registerA2AJsonRpc(
  server,
  {
    requestHandler,
    rpcPath = '/a2a',
    authenticate = async () => new UnauthenticatedUser(),
    contextBuilder = defaultServerCallContextBuilder,
  }
) {
  const transport = new JsonRpcTransportHandler(requestHandler)

  server.route({
    method: 'GET',
    path: `/${AGENT_CARD_PATH}`,
    handler: async (_request, h) =>
      h
        .response(AgentCard.toJSON(await requestHandler.getAgentCard()))
        .type(JSON_CONTENT_TYPE)
        .header('cache-control', 'no-cache'),
  })

  server.route({
    method: 'POST',
    path: rpcPath,
    options: {
      payload: {
        output: 'data',
        parse: false,
        maxBytes: 1024 * 1024,
      },
    },
    handler: async (request, h) => {
      const rawContentType = header(request, 'content-type')
      const mediaType = rawContentType?.split(';', 1)[0].trim().toLowerCase()
      const rawBody = Buffer.isBuffer(request.payload)
        ? request.payload.toString('utf8')
        : String(request.payload ?? '')
      let requestBody
      let parseFailed = false

      try {
        requestBody = JSON.parse(rawBody)
      } catch {
        parseFailed = true
        requestBody = undefined
      }

      if (rawContentType && mediaType !== JSON_CONTENT_TYPE) {
        return h
          .response(
            jsonRpcError(
              requestBody,
              new ContentTypeNotSupportedError(
                `Unsupported Content-Type "${rawContentType}"; expected application/json.`
              )
            )
          )
          .code(400)
          .type(JSON_CONTENT_TYPE)
      }

      if (parseFailed) {
        return h
          .response({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: A2A_ERROR_CODE.PARSE_ERROR,
              message: 'Invalid JSON payload.',
            },
          })
          .code(400)
          .type(JSON_CONTENT_TYPE)
      }

      let context
      try {
        const requestedExtensions = Extensions.parseServiceParameter(
          header(request, HTTP_EXTENSION_HEADER)
        )
        context = contextBuilder({
          extensions: requestedExtensions,
          user: await authenticate(request),
          headers: request.headers,
          requestedVersion: header(request, A2A_VERSION_HEADER),
        })
        validateVersion(context.requestedVersion, await requestHandler.getAgentCard(), 'JSONRPC')
      } catch (error) {
        if (error.statusCode) {
          const response = h.response({ error: error.message }).code(error.statusCode)
          if (error.challenge) {
            response.header('www-authenticate', error.challenge)
          }
          return response
        }
        return h.response(jsonRpcError(requestBody, error)).type(JSON_CONTENT_TYPE)
      }

      const result = await transport.handle(rawBody, context)
      if (!isAsyncIterable(result)) {
        return applyActivatedExtensions(h.response(result).type(JSON_CONTENT_TYPE), context)
      }

      const iterator = result[Symbol.asyncIterator]()
      let firstResult
      try {
        firstResult = await iterator.next()
      } catch (error) {
        return h.response(jsonRpcError(requestBody, error)).type(JSON_CONTENT_TYPE)
      }

      const output = new PassThrough()
      void pumpSse({ output, iterator, firstResult, requestBody })

      const response = h.response(output)
      for (const [name, value] of Object.entries(SSE_HEADERS)) {
        response.header(name, value)
      }
      applyActivatedExtensions(response, context)
      return response
    },
  })
}
