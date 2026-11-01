import Hapi from '@hapi/hapi'
import { TaskState } from '@a2a-js/sdk'
import { ClientFactory } from '@a2a-js/sdk/client'
import { z } from 'zod'

import {
  createAgentCard,
  createMessage,
  createSendRequest,
  dataPart,
  firstPart,
  publishArtifact,
  publishStatus,
  publishTask,
  sleep,
  textPart,
} from '../../src/lib/a2a-builders.js'
import { createA2AServer, startServer, stopServers } from '../../src/lib/create-server.js'

const providerResultSchema = z.object({
  key: z.string(),
  value: z.string(),
  asOf: z.string(),
})

class UpstreamError extends Error {
  constructor(message, { status, retryAfter } = {}) {
    super(message)
    this.status = status
    this.retryAfter = retryAfter
  }
}

export async function createMockProvider({ port = 0 } = {}) {
  const server = Hapi.server({ port, host: '127.0.0.1' })
  const hits = new Map()

  server.route({
    method: 'GET',
    path: '/records/{key}',
    handler: async (request, h) => {
      if (request.headers['x-provider-key'] !== 'local-provider-secret') {
        return h.response({ error: 'provider authentication failed' }).code(401)
      }
      const { key } = request.params
      hits.set(key, (hits.get(key) ?? 0) + 1)
      if (key === 'rate-limited') {
        return h.response({ error: 'rate limited' }).header('retry-after', '2').code(429)
      }
      if (key === 'unavailable') {
        return h.response({ error: 'unavailable' }).code(503)
      }
      if (key === 'slow') {
        await sleep(250)
      }
      return {
        key,
        value: `provider-value-for-${key}`,
        asOf: new Date().toISOString(),
      }
    },
  })

  return { server, hits }
}

class CachedProviderClient {
  constructor({ providerUrl, ttlMs = 60_000, timeoutMs = 100, now = () => Date.now() }) {
    this.providerUrl = providerUrl
    this.ttlMs = ttlMs
    this.timeoutMs = timeoutMs
    this.now = now
    this.cache = new Map()
  }

  async getRecord(key) {
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > this.now()) {
      return { ...cached.value, cacheHit: true }
    }

    let response
    try {
      response = await fetch(`${this.providerUrl}/records/${encodeURIComponent(key)}`, {
        headers: { 'X-Provider-Key': 'local-provider-secret' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new UpstreamError(`Provider request failed: ${error.message}`)
    }
    if (!response.ok) {
      throw new UpstreamError(`Provider returned HTTP ${response.status}`, {
        status: response.status,
        retryAfter: response.headers.get('retry-after'),
      })
    }
    const value = providerResultSchema.parse(await response.json())
    this.cache.set(key, { value, expiresAt: this.now() + this.ttlMs })
    return { ...value, cacheHit: false }
  }
}

class ProviderAdapterExecutor {
  constructor(providerClient) {
    this.providerClient = providerClient
  }

  async execute(requestContext, eventBus) {
    const key = firstPart(requestContext.userMessage, 'text') ?? ''
    publishTask(eventBus, requestContext)
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_WORKING, 'Calling provider')
    try {
      const record = await this.providerClient.getRecord(key)
      publishArtifact(eventBus, requestContext, {
        name: 'provider-record',
        parts: [dataPart(record)],
      })
      publishStatus(eventBus, requestContext, TaskState.TASK_STATE_COMPLETED)
    } catch (error) {
      publishStatus(eventBus, requestContext, TaskState.TASK_STATE_FAILED, error.message, {
        upstreamStatus: error.status,
        retryAfter: error.retryAfter,
      })
    }
  }

  async cancelTask() {}
}

export async function createServer({ providerUrl, port = 0, ttlMs, timeoutMs, now } = {}) {
  const providerClient = new CachedProviderClient({ providerUrl, ttlMs, timeoutMs, now })
  const agentCard = createAgentCard({
    name: 'Provider Adapter Agent',
    description: 'Wraps an ordinary REST provider as an A2A skill',
    url: `http://127.0.0.1:${port}/a2a`,
    skills: [
      {
        id: 'fetch-provider-record',
        name: 'Fetch provider record',
        description: 'Fetch and cache a validated provider record',
        tags: ['adapter', 'cache', 'rest-provider'],
        inputModes: ['text/plain'],
        outputModes: ['application/json'],
      },
    ],
  })
  return {
    ...(await createA2AServer({
      agentCard,
      executor: new ProviderAdapterExecutor(providerClient),
      port,
    })),
    providerClient,
  }
}

export async function runClient({ agentUrl, key }) {
  const client = await new ClientFactory().createFromUrl(agentUrl)
  return client.sendMessage(
    createSendRequest(createMessage({ parts: [textPart(key)] }), {
      returnImmediately: false,
      acceptedOutputModes: ['application/json'],
    })
  )
}

export async function runDemo() {
  const provider = await createMockProvider()
  let agent
  try {
    const providerUrl = await startServer(provider.server)
    agent = await createServer({ providerUrl })
    const agentUrl = await startServer(agent)
    const first = await runClient({ agentUrl, key: 'example' })
    const second = await runClient({ agentUrl, key: 'example' })
    console.log(`[10] First cache hit: ${firstPart(first.artifacts[0], 'data').cacheHit}`)
    console.log(`[10] Second cache hit: ${firstPart(second.artifacts[0], 'data').cacheHit}`)
    console.log(`[10] Provider calls: ${provider.hits.get('example')}`)
    return { first, second, providerHits: provider.hits }
  } finally {
    await stopServers(agent?.server, provider.server)
  }
}
