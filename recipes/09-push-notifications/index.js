import Hapi from '@hapi/hapi'
import { TaskState } from '@a2a-js/sdk'
import { ClientFactory } from '@a2a-js/sdk/client'
import { RequestMalformedError } from '@a2a-js/sdk/errors'
import { DefaultPushNotificationSender, InMemoryPushNotificationStore } from '@a2a-js/sdk/server'

import {
  createAgentCard,
  createMessage,
  createSendRequest,
  publishArtifact,
  publishStatus,
  publishTask,
  sleep,
  textPart,
} from '../../src/lib/a2a-builders.js'
import { createA2AServer, startServer, stopServers } from '../../src/lib/create-server.js'

class AllowlistedPushStore {
  constructor(allowedHosts) {
    this.allowedHosts = new Set(allowedHosts)
    this.delegate = new InMemoryPushNotificationStore()
  }

  async save(taskId, context, config) {
    const target = new URL(config.url)
    if (!this.allowedHosts.has(target.host)) {
      throw new RequestMalformedError('Push notification URL is not allowlisted')
    }
    await this.delegate.save(taskId, context, config)
  }

  async load(taskId, context) {
    return this.delegate.load(taskId, context)
  }

  async loadWithMetadata(taskId, context) {
    return this.delegate.loadWithMetadata(taskId, context)
  }

  async delete(taskId, context, configId) {
    await this.delegate.delete(taskId, context, configId)
  }
}

class NotificationExecutor {
  async execute(requestContext, eventBus) {
    publishTask(eventBus, requestContext)
    for (let step = 1; step <= 3; step += 1) {
      publishStatus(
        eventBus,
        requestContext,
        TaskState.TASK_STATE_WORKING,
        `Background step ${step}`
      )
      await sleep(35)
    }
    publishArtifact(eventBus, requestContext, {
      name: 'notification-result',
      parts: [textPart('Background work completed')],
    })
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_COMPLETED)
  }

  async cancelTask() {}
}

export async function createWebhookServer({ token, port = 0 } = {}) {
  const server = Hapi.server({ port, host: '127.0.0.1' })
  const notifications = []
  const terminalTasks = new Set()
  const waiters = new Map()

  server.route({
    method: 'POST',
    path: '/callbacks/a2a',
    handler: (request, h) => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        return h.response({ error: 'Unauthorized callback' }).code(401)
      }
      const event = request.payload
      notifications.push(event)
      const update = event.statusUpdate
      if (update?.status?.state === 'TASK_STATE_COMPLETED') {
        terminalTasks.add(update.taskId)
        waiters.get(update.taskId)?.()
      }
      return h.response().code(204)
    },
  })

  return {
    server,
    notifications,
    async waitForTerminal(taskId) {
      if (terminalTasks.has(taskId)) {
        return
      }
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for notification for ${taskId}`)),
          2_000
        )
        waiters.set(taskId, () => {
          clearTimeout(timeout)
          resolve()
        })
      })
      waiters.delete(taskId)
    },
  }
}

export async function createServer({ allowedWebhookHost, port = 0 } = {}) {
  const pushNotificationStore = new AllowlistedPushStore([allowedWebhookHost])
  const pushNotificationSender = new DefaultPushNotificationSender(pushNotificationStore)
  const agentCard = createAgentCard({
    name: 'Push Notification Agent',
    description: 'Sends authenticated task updates to a client webhook',
    url: `http://127.0.0.1:${port}/a2a`,
    pushNotifications: true,
    skills: [
      {
        id: 'run-notified-work',
        name: 'Run notified work',
        description: 'Run background work and deliver webhook notifications',
        tags: ['push-notifications', 'webhook'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
    ],
  })
  return createA2AServer({
    agentCard,
    executor: new NotificationExecutor(),
    port,
    pushNotificationStore,
    pushNotificationSender,
  })
}

function pushConfig({ taskId = '', webhookUrl, token }) {
  return {
    tenant: '',
    id: '',
    taskId,
    url: webhookUrl,
    token: '',
    authentication: { scheme: 'Bearer', credentials: token },
  }
}

export async function runClient({ agentUrl, webhookUrl, token, webhook }) {
  const client = await new ClientFactory().createFromUrl(agentUrl)

  const inlineTask = await client.sendMessage(
    createSendRequest(createMessage({ parts: [textPart('Notify inline')] }), {
      returnImmediately: true,
      taskPushNotificationConfig: pushConfig({ webhookUrl, token }),
    })
  )
  await webhook.waitForTerminal(inlineTask.id)

  const configuredTask = await client.sendMessage(
    createSendRequest(createMessage({ parts: [textPart('Notify after creation')] }), {
      returnImmediately: true,
    })
  )
  const createdConfig = await client.createTaskPushNotificationConfig(
    pushConfig({ taskId: configuredTask.id, webhookUrl, token })
  )
  const listedConfigs = await client.listTaskPushNotificationConfig({
    tenant: '',
    taskId: configuredTask.id,
  })
  const loadedConfig = await client.getTaskPushNotificationConfig({
    tenant: '',
    taskId: configuredTask.id,
    id: createdConfig.id,
  })
  await webhook.waitForTerminal(configuredTask.id)
  const reconciled = await client.getTask({ id: configuredTask.id, tenant: '' })
  await client.deleteTaskPushNotificationConfig({
    tenant: '',
    taskId: configuredTask.id,
    id: createdConfig.id,
  })

  return {
    inlineTask,
    configuredTask,
    createdConfig,
    listedConfigs,
    loadedConfig,
    reconciled,
  }
}

export async function runDemo() {
  const token = 'cookbook-webhook-token'
  const webhook = await createWebhookServer({ token })
  let agent
  try {
    const webhookUrlBase = await startServer(webhook.server)
    const callbackUrl = `${webhookUrlBase}/callbacks/a2a`
    agent = await createServer({ allowedWebhookHost: new URL(callbackUrl).host })
    const agentUrl = await startServer(agent)
    const result = await runClient({
      agentUrl,
      webhookUrl: callbackUrl,
      token,
      webhook,
    })
    console.log(`[09] Authenticated notifications: ${webhook.notifications.length}`)
    console.log(`[09] Reconciled state: ${result.reconciled.status.state}`)
    return { ...result, notifications: webhook.notifications }
  } finally {
    await stopServers(agent?.server, webhook.server)
  }
}
