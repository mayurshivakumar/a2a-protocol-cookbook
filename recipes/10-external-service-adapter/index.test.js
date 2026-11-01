import { afterEach, describe, expect, it } from 'vitest'

import { TaskState } from '@a2a-js/sdk'

import { firstPart } from '../../src/lib/a2a-builders.js'
import { startServer, stopServers } from '../../src/lib/create-server.js'
import { createMockProvider, createServer, runClient } from './index.js'

const servers = []

afterEach(async () => stopServers(...servers.splice(0)))

describe('external service adapter', () => {
  it('validates and caches provider data behind an A2A skill', async () => {
    const provider = await createMockProvider()
    servers.push(provider.server)
    const providerUrl = await startServer(provider.server)
    const agent = await createServer({ providerUrl })
    servers.push(agent.server)
    const agentUrl = await startServer(agent)

    const first = await runClient({ agentUrl, key: 'example' })
    const second = await runClient({ agentUrl, key: 'example' })
    expect(firstPart(first.artifacts[0], 'data').cacheHit).toBe(false)
    expect(firstPart(second.artifacts[0], 'data').cacheHit).toBe(true)
    expect(provider.hits.get('example')).toBe(1)

    let clock = 1_000
    const expiringAgent = await createServer({
      providerUrl,
      ttlMs: 50,
      now: () => clock,
    })
    servers.push(expiringAgent.server)
    const expiringUrl = await startServer(expiringAgent)
    await runClient({ agentUrl: expiringUrl, key: 'expiring' })
    clock += 51
    await runClient({ agentUrl: expiringUrl, key: 'expiring' })
    expect(provider.hits.get('expiring')).toBe(2)
  })

  it('maps rate limits and timeouts to failed A2A tasks', async () => {
    const provider = await createMockProvider()
    servers.push(provider.server)
    const providerUrl = await startServer(provider.server)
    const agent = await createServer({ providerUrl, timeoutMs: 40 })
    servers.push(agent.server)
    const agentUrl = await startServer(agent)

    const limited = await runClient({ agentUrl, key: 'rate-limited' })
    const timedOut = await runClient({ agentUrl, key: 'slow' })
    expect(limited.status.state).toBe(TaskState.TASK_STATE_FAILED)
    expect(limited.status.message.metadata).toMatchObject({
      upstreamStatus: 429,
      retryAfter: '2',
    })
    expect(timedOut.status.state).toBe(TaskState.TASK_STATE_FAILED)
  })
})
