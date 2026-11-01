import { afterEach, describe, expect, it } from 'vitest'

import { firstPart } from '../../src/lib/a2a-builders.js'
import { startServer, stopServers } from '../../src/lib/create-server.js'
import { createLookupServer, createServer, runClient } from './index.js'

const servers = []

afterEach(async () => stopServers(...servers.splice(0)))

describe('delegating agent', () => {
  it('acts as a server upstream and a client downstream', async () => {
    const lookup = await createLookupServer()
    servers.push(lookup.server)
    const lookupUrl = await startServer(lookup)
    const delegating = await createServer({ downstreamUrl: lookupUrl })
    servers.push(delegating.server)
    const url = await startServer(delegating)

    const events = await runClient({ agentUrl: url, topic: 'A2A' })
    const artifactEvent = events.find(({ payload }) => payload.$case === 'artifactUpdate')
    const output = firstPart(artifactEvent.payload.value.artifact, 'data')
    expect(output.degraded).toBe(false)
    expect(output.lookup.facts).toHaveLength(2)

    const [correlation] = delegating.executor.correlations.values()
    expect(correlation.agentUrl).toBe(lookupUrl)
    expect(correlation.contextId).not.toBe(artifactEvent.payload.value.contextId)
  })

  it('publishes a marked fallback when the downstream agent is unavailable', async () => {
    const delegating = await createServer({ downstreamUrl: 'http://127.0.0.1:1' })
    servers.push(delegating.server)
    const url = await startServer(delegating)
    const events = await runClient({ agentUrl: url, topic: 'fallback' })
    const artifact = events.find(({ payload }) => payload.$case === 'artifactUpdate').payload.value
    expect(firstPart(artifact.artifact, 'data').degraded).toBe(true)
  })
})
