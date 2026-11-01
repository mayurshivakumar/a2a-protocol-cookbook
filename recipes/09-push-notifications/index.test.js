import { afterEach, describe, expect, it } from 'vitest'

import { TaskState } from '@a2a-js/sdk'

import { startServer, stopServers } from '../../src/lib/create-server.js'
import { createWebhookServer, runDemo } from './index.js'

let server

afterEach(async () => stopServers(server))

describe('push notifications', () => {
  it('delivers authenticated StreamResponse callbacks and supports config CRUD', async () => {
    const result = await runDemo()

    expect(result.notifications.length).toBeGreaterThanOrEqual(8)
    expect(result.notifications.every((event) => Object.keys(event).length === 1)).toBe(true)
    expect(result.reconciled.status.state).toBe(TaskState.TASK_STATE_COMPLETED)
    expect(result.createdConfig.id).not.toBe('')
    expect(result.loadedConfig.id).toBe(result.createdConfig.id)
    expect(result.listedConfigs.configs).toContainEqual(result.createdConfig)
  })

  it('rejects a callback with the wrong HTTP credential', async () => {
    const webhook = await createWebhookServer({ token: 'expected' })
    server = webhook.server
    const url = await startServer(server)
    const response = await fetch(`${url}/callbacks/a2a`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/a2a+json',
        Authorization: 'Bearer wrong',
      },
      body: JSON.stringify({ statusUpdate: {} }),
    })
    expect(response.status).toBe(401)
    expect(webhook.notifications).toHaveLength(0)
  })
})
