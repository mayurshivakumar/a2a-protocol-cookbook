import { afterEach, describe, expect, it } from 'vitest'

import { startServer, stopServers } from './create-server.js'
import { createServer } from '../../recipes/02-synchronous-exchange/index.js'

let server

afterEach(async () => stopServers(server))

describe('Hapi A2A adapter', () => {
  it('serves an Agent Card and protocol-level errors', async () => {
    const agent = await createServer()
    server = agent.server
    const url = await startServer(agent)

    const cardResponse = await fetch(`${url}/.well-known/agent-card.json`)
    const card = await cardResponse.json()
    expect(card.supportedInterfaces[0]).toMatchObject({
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
      url: `${url}/a2a`,
    })

    const versionResponse = await fetch(`${url}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'A2A-Version': '9.9' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetTask', params: { id: 'x' } }),
    })
    const versionError = await versionResponse.json()
    expect(versionError.error.data[0].reason).toBe('VERSION_NOT_SUPPORTED')

    const contentTypeResponse = await fetch(`${url}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'A2A-Version': '1.0' },
      body: '{}',
    })
    expect(contentTypeResponse.status).toBe(400)

    const parseResponse = await fetch(`${url}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0' },
      body: '{',
    })
    expect(parseResponse.status).toBe(400)
    expect((await parseResponse.json()).error.code).toBe(-32700)

    const unknownMethodResponse = await fetch(`${url}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'UnknownMethod', params: {} }),
    })
    expect((await unknownMethodResponse.json()).error.code).toBe(-32601)
  })
})
