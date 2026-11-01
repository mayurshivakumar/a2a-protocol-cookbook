import { afterEach, describe, expect, it } from 'vitest'

import { ClientFactory } from '@a2a-js/sdk/client'

import { createMessage, createSendRequest, dataPart } from '../../src/lib/a2a-builders.js'
import { startServer, stopServers } from '../../src/lib/create-server.js'
import { createServer, runClient } from './index.js'

let server

afterEach(async () => stopServers(server))

describe('long-running multi-turn task', () => {
  it('polls, pauses, and continues the same active task', async () => {
    const agent = await createServer()
    server = agent.server
    const url = await startServer(agent)
    const result = await runClient({ agentUrl: url })

    expect(result.submitted.id).toBe(result.paused.id)
    expect(result.paused.id).toBe(result.completed.id)
    expect(result.completed.history.length).toBeGreaterThanOrEqual(3)

    const client = await new ClientFactory().createFromUrl(url)
    await expect(
      client.sendMessage(
        createSendRequest(
          createMessage({
            taskId: result.completed.id,
            contextId: result.completed.contextId,
            parts: [dataPart({ approvalCode: 'APPROVED' })],
          })
        )
      )
    ).rejects.toMatchObject({ reason: 'UNSUPPORTED_OPERATION' })
  })
})
