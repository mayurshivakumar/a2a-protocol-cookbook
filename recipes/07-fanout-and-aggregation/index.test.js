import { afterEach, describe, expect, it } from 'vitest'

import { TaskState } from '@a2a-js/sdk'
import { ClientFactory } from '@a2a-js/sdk/client'

import {
  createMessage,
  createSendRequest,
  dataPart,
  firstPart,
  sleep,
  textPart,
} from '../../src/lib/a2a-builders.js'
import { startServer, stopServers } from '../../src/lib/create-server.js'
import { createDataSourceServer, createServer, runClient } from './index.js'

const servers = []

afterEach(async () => stopServers(...servers.splice(0)))

async function startMesh(failures = []) {
  const sources = await Promise.all(
    ['Alpha', 'Beta', 'Gamma'].map((source) =>
      createDataSourceServer({ source, fail: failures.includes(source) })
    )
  )
  servers.push(...sources.map(({ server }) => server))
  const childUrls = await Promise.all(sources.map(startServer))
  const coordinator = await createServer({ childUrls })
  servers.push(coordinator.server)
  const coordinatorUrl = await startServer(coordinator)
  return { sources, coordinator, coordinatorUrl }
}

describe('fan-out and aggregation', () => {
  it('completes with provenance and degradation when one child fails', async () => {
    const { coordinatorUrl } = await startMesh(['Gamma'])
    const task = await runClient({ agentUrl: coordinatorUrl, query: 'status' })
    const result = firstPart(task.artifacts[0], 'data')
    expect(task.status.state).toBe(TaskState.TASK_STATE_COMPLETED)
    expect(result.results).toHaveLength(2)
    expect(result.missing).toHaveLength(1)
    expect(task.artifacts[0].metadata.sources).toHaveLength(2)
  })

  it('fails only when all children fail', async () => {
    const { coordinatorUrl } = await startMesh(['Alpha', 'Beta', 'Gamma'])
    const task = await runClient({ agentUrl: coordinatorUrl, query: 'status' })
    expect(task.status.state).toBe(TaskState.TASK_STATE_FAILED)
  })

  it('propagates parent cancellation to in-flight child tasks', async () => {
    const { coordinator, coordinatorUrl } = await startMesh()
    const client = await new ClientFactory().createFromUrl(coordinatorUrl)
    const parent = await client.sendMessage(
      createSendRequest(createMessage({ parts: [textPart('cancel fan-out')] }), {
        returnImmediately: true,
      })
    )

    while ((coordinator.executor.runs.get(parent.id)?.children.length ?? 0) < 3) {
      await sleep(5)
    }
    const canceled = await client.cancelTask({ id: parent.id, tenant: '' })
    expect(canceled.status.state).toBe(TaskState.TASK_STATE_CANCELED)

    const childStates = await Promise.all(
      coordinator.executor.runs
        .get(parent.id)
        .children.map(({ client: childClient, taskId }) =>
          childClient.getTask({ id: taskId, tenant: '' }).then(({ status }) => status.state)
        )
    )
    expect(childStates).toEqual([
      TaskState.TASK_STATE_CANCELED,
      TaskState.TASK_STATE_CANCELED,
      TaskState.TASK_STATE_CANCELED,
    ])
  })
})
