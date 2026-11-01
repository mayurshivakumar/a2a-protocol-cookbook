import { afterEach, describe, expect, it, vi } from 'vitest'

import { ClientFactory, ServiceParameters } from '@a2a-js/sdk/client'

import { createMessage, createSendRequest, textPart } from '../../src/lib/a2a-builders.js'
import { startServer, stopServers } from '../../src/lib/create-server.js'
import { createServer, runClient } from './index.js'

let server

afterEach(async () => {
  vi.restoreAllMocks()
  await stopServers(server)
})

describe('security and trust', () => {
  it('verifies cards, rejects tampering, fetches an extended card, and negotiates versions', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const agent = await createServer()
    server = agent.server
    const url = await startServer(agent)
    const result = await runClient({ agentUrl: url })

    expect(result.signedCard.signatures).toHaveLength(1)
    expect(result.signedCard.securitySchemes.cookbookApiKey.scheme.$case).toBe(
      'apiKeySecurityScheme'
    )
    expect(result.tamperRejected).toBe(true)
    expect(result.extendedCard.skills.map(({ id }) => id)).toContain('privileged-limits')
    expect(result.badVersion.error.data[0].reason).toBe('VERSION_NOT_SUPPORTED')
  })

  it('keeps credentials in HTTP headers and rejects an unauthenticated call', async () => {
    const agent = await createServer()
    server = agent.server
    const url = await startServer(agent)
    const client = await new ClientFactory().createFromUrl(url)
    const request = createSendRequest(createMessage({ parts: [textPart('secure')] }))

    await expect(client.sendMessage(request)).rejects.toThrow()
    const authenticated = await client.sendMessage(request, {
      serviceParameters: ServiceParameters.createFrom({ 'X-Api-Key': 'cookbook-api-key' }),
    })
    expect(authenticated.artifacts[0].parts[0].content.value).toContain('cookbook-client')
  })
})
