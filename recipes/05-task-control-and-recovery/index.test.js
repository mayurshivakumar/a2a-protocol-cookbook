import { afterEach, describe, expect, it } from 'vitest'

import { TaskState } from '@a2a-js/sdk'
import { ClientFactory } from '@a2a-js/sdk/client'

import { createMessage, createSendRequest, sleep, textPart } from '../../src/lib/a2a-builders.js'
import { startServer, stopServers } from '../../src/lib/create-server.js'
import { createServer, runClient } from './index.js'

let server

afterEach(async () => stopServers(server))

describe('task control and recovery', () => {
  it('resubscribes, cancels, and cursor-paginates task listings', async () => {
    const agent = await createServer()
    server = agent.server
    const url = await startServer(agent)
    const first = await runClient({ agentUrl: url })
    const second = await runClient({ agentUrl: url })

    expect(first.canceled.status.state).toBe(TaskState.TASK_STATE_CANCELED)
    expect(first.events.some(({ payload }) => payload.$case === 'statusUpdate')).toBe(true)

    const client = await new ClientFactory().createFromUrl(url)
    const page1 = await client.listTasks({
      tenant: '',
      status: TaskState.TASK_STATE_CANCELED,
      pageSize: 1,
      pageToken: '',
      includeArtifacts: false,
    })
    const page2 = await client.listTasks({
      tenant: '',
      status: TaskState.TASK_STATE_CANCELED,
      pageSize: 1,
      pageToken: page1.nextPageToken,
      includeArtifacts: false,
    })
    expect(page1.tasks).toHaveLength(1)
    expect(page1.nextPageToken).not.toBe('')
    expect(page2.tasks).toHaveLength(1)
    expect(new Set([page1.tasks[0].id, page2.tasks[0].id])).toEqual(
      new Set([first.canceled.id, second.canceled.id])
    )
  })

  it('allows multiple concurrent subscriptions to one active task', async () => {
    const agent = await createServer()
    server = agent.server
    const url = await startServer(agent)
    const client = await new ClientFactory().createFromUrl(url)
    const task = await client.sendMessage(
      createSendRequest(createMessage({ parts: [textPart('observe twice')] }), {
        returnImmediately: true,
      })
    )

    const collect = async (stream) => {
      const events = []
      for await (const event of stream) {
        events.push(event)
      }
      return events
    }
    const firstSubscription = collect(client.resubscribeTask({ id: task.id, tenant: '' }))
    const secondSubscription = collect(client.resubscribeTask({ id: task.id, tenant: '' }))
    await sleep(45)
    await client.cancelTask({ id: task.id, tenant: '' })

    const [firstEvents, secondEvents] = await Promise.all([firstSubscription, secondSubscription])
    for (const events of [firstEvents, secondEvents]) {
      expect(events.at(-1).payload.value.status.state).toBe(TaskState.TASK_STATE_CANCELED)
    }
  })
})
