import { afterEach, describe, expect, it } from 'vitest'

import { TaskState } from '@a2a-js/sdk'

import { startServer, stopServers } from '../../src/lib/create-server.js'
import { createServer, runClient } from './index.js'

let server

afterEach(async () => stopServers(server))

describe('streaming results', () => {
  it('streams one task, status updates, and appendable artifact chunks', async () => {
    const agent = await createServer()
    server = agent.server
    const url = await startServer(agent)
    const events = await runClient({ agentUrl: url, topic: 'A2A' })

    expect(events.map(({ payload }) => payload.$case)).toEqual([
      'task',
      'statusUpdate',
      'artifactUpdate',
      'artifactUpdate',
      'artifactUpdate',
      'statusUpdate',
    ])
    const chunks = events
      .filter(({ payload }) => payload.$case === 'artifactUpdate')
      .map(({ payload }) => payload.value)
    expect(new Set(chunks.map(({ artifact }) => artifact.artifactId)).size).toBe(1)
    expect(chunks.map(({ append }) => append)).toEqual([false, true, true])
    expect(chunks.map(({ lastChunk }) => lastChunk)).toEqual([false, false, true])
    expect(events.at(-1).payload.value.status.state).toBe(TaskState.TASK_STATE_COMPLETED)
  })
})
