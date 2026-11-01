import { afterEach, describe, expect, it } from 'vitest'

import { TaskState } from '@a2a-js/sdk'

import { firstPart } from '../../src/lib/a2a-builders.js'
import { startServer, stopServers } from '../../src/lib/create-server.js'
import { createServer, runClient } from './index.js'

let server

afterEach(async () => stopServers(server))

describe('synchronous structured exchange', () => {
  it('returns a completed task containing a typed artifact', async () => {
    const agent = await createServer()
    server = agent.server
    const url = await startServer(agent)
    const task = await runClient({
      agentUrl: url,
      input: { title: ' Build ', items: [' Test ', ' Ship '] },
    })

    expect(task.status.state).toBe(TaskState.TASK_STATE_COMPLETED)
    expect(firstPart(task.artifacts[0], 'data')).toEqual({
      title: 'Build',
      items: [
        { order: 1, value: 'Test' },
        { order: 2, value: 'Ship' },
      ],
    })
  })

  it('maps a Zod boundary failure to an A2A malformed-request error', async () => {
    const agent = await createServer()
    server = agent.server
    const url = await startServer(agent)

    await expect(
      runClient({ agentUrl: url, input: { title: '', items: [] } })
    ).rejects.toMatchObject({ reason: 'INVALID_PARAMS' })
  })
})
