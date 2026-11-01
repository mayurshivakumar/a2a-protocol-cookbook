import { TaskState } from '@a2a-js/sdk'
import { ClientFactory } from '@a2a-js/sdk/client'

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

class CancellableExecutor {
  constructor() {
    this.cancelled = new Set()
  }

  async execute(requestContext, eventBus) {
    publishTask(eventBus, requestContext)
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_WORKING, 'Step 1 of 5')

    try {
      for (let step = 2; step <= 5; step += 1) {
        await sleep(35)
        if (this.cancelled.has(requestContext.taskId)) {
          publishStatus(eventBus, requestContext, TaskState.TASK_STATE_CANCELED, 'Work canceled')
          return
        }
        publishStatus(eventBus, requestContext, TaskState.TASK_STATE_WORKING, `Step ${step} of 5`)
      }

      publishArtifact(eventBus, requestContext, {
        name: 'background-result',
        parts: [textPart('All steps completed')],
      })
      publishStatus(eventBus, requestContext, TaskState.TASK_STATE_COMPLETED)
    } finally {
      this.cancelled.delete(requestContext.taskId)
    }
  }

  async cancelTask(taskId) {
    this.cancelled.add(taskId)
  }
}

export async function createServer({ port = 0 } = {}) {
  const agentCard = createAgentCard({
    name: 'Controllable Background Agent',
    description: 'Demonstrates task listing, subscriptions, and cancellation',
    url: `http://127.0.0.1:${port}/a2a`,
    streaming: true,
    skills: [
      {
        id: 'run-background-job',
        name: 'Run background job',
        description: 'Run a cancellable multi-step job',
        tags: ['tasks', 'subscription', 'cancellation'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
    ],
  })
  return createA2AServer({ agentCard, executor: new CancellableExecutor(), port })
}

export async function runClient({ agentUrl }) {
  const client = await new ClientFactory().createFromUrl(agentUrl)
  const submitted = await client.sendMessage(
    createSendRequest(createMessage({ parts: [textPart('Run the background job')] }), {
      returnImmediately: true,
      acceptedOutputModes: ['text/plain'],
    })
  )

  const subscription = client.resubscribeTask({ id: submitted.id, tenant: '' })
  const cancellation = (async () => {
    await sleep(65)
    return client.cancelTask({ id: submitted.id, tenant: '' })
  })()

  const events = []
  for await (const event of subscription) {
    events.push(event)
  }
  const canceled = await cancellation
  const listed = await client.listTasks({
    tenant: '',
    status: TaskState.TASK_STATE_CANCELED,
    pageSize: 1,
    pageToken: '',
    includeArtifacts: false,
  })

  return { submitted, events, canceled, listed }
}

export async function runDemo() {
  const agent = await createServer()
  try {
    const url = await startServer(agent)
    const result = await runClient({ agentUrl: url })
    console.log(`[05] Subscription events: ${result.events.length}`)
    console.log(`[05] Canceled state: ${result.canceled.status.state}`)
    console.log(`[05] ListTasks returned: ${result.listed.tasks.length}`)
    return result
  } finally {
    await stopServers(agent.server)
  }
}
