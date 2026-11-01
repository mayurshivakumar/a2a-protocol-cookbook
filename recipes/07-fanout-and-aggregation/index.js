import { TaskState } from '@a2a-js/sdk'
import { ClientFactory } from '@a2a-js/sdk/client'

import {
  createAgentCard,
  createMessage,
  createSendRequest,
  dataPart,
  firstPart,
  publishArtifact,
  publishStatus,
  publishTask,
  sleep,
  textPart,
} from '../../src/lib/a2a-builders.js'
import { createA2AServer, startServer, stopServers } from '../../src/lib/create-server.js'

const terminalStates = new Set([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
])

class DataSourceExecutor {
  constructor({ source, fail = false }) {
    this.source = source
    this.fail = fail
    this.cancelled = new Set()
  }

  async execute(requestContext, eventBus) {
    publishTask(eventBus, requestContext)
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_WORKING, `${this.source} started`)
    try {
      for (let step = 0; step < 4; step += 1) {
        await sleep(25)
        if (this.cancelled.has(requestContext.taskId)) {
          publishStatus(eventBus, requestContext, TaskState.TASK_STATE_CANCELED)
          return
        }
      }
      if (this.fail) {
        publishStatus(
          eventBus,
          requestContext,
          TaskState.TASK_STATE_FAILED,
          `${this.source} unavailable`,
          { retryAfter: 1 }
        )
        return
      }
      publishArtifact(eventBus, requestContext, {
        name: `${this.source}-result`,
        parts: [dataPart({ source: this.source, value: `${this.source} data` })],
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

class FanoutExecutor {
  constructor(childUrls) {
    this.childUrls = childUrls
    this.runs = new Map()
  }

  async childClients() {
    this.clients ??= await Promise.all(
      this.childUrls.map(async (agentUrl) => ({
        agentUrl,
        client: await new ClientFactory().createFromUrl(agentUrl),
      }))
    )
    return this.clients
  }

  async waitForTask(client, taskId) {
    while (true) {
      const task = await client.getTask({ id: taskId, tenant: '' })
      if (terminalStates.has(task.status.state)) {
        return task
      }
      await sleep(15)
    }
  }

  async execute(requestContext, eventBus) {
    const query = firstPart(requestContext.userMessage, 'text') ?? 'generic query'
    publishTask(eventBus, requestContext)
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_WORKING, 'Dispatching in parallel')

    const run = { cancelled: false, children: [] }
    this.runs.set(requestContext.taskId, run)
    const clients = await this.childClients()
    const submissions = await Promise.allSettled(
      clients.map(async ({ agentUrl, client }) => {
        const task = await client.sendMessage(
          createSendRequest(createMessage({ parts: [textPart(query)] }), {
            returnImmediately: true,
            acceptedOutputModes: ['application/json'],
          })
        )
        const child = { agentUrl, client, taskId: task.id, contextId: task.contextId }
        run.children.push(child)
        return { ...child, task: await this.waitForTask(client, task.id) }
      })
    )

    if (run.cancelled) {
      publishStatus(eventBus, requestContext, TaskState.TASK_STATE_CANCELED)
      return
    }

    const finished = submissions
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value)
    const successful = finished.filter(
      ({ task }) => task.status.state === TaskState.TASK_STATE_COMPLETED
    )
    const missing = [
      ...finished
        .filter(({ task }) => task.status.state !== TaskState.TASK_STATE_COMPLETED)
        .map(({ agentUrl }) => agentUrl),
      ...submissions
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason.message),
    ]

    if (successful.length === 0) {
      publishStatus(eventBus, requestContext, TaskState.TASK_STATE_FAILED, 'All child tasks failed')
      return
    }

    publishArtifact(eventBus, requestContext, {
      name: 'aggregated-result',
      parts: [
        dataPart({
          query,
          results: successful.map(({ task }) => firstPart(task.artifacts[0], 'data')),
          missing,
        }),
      ],
      metadata: {
        degraded: missing.length > 0,
        sources: successful.map(({ agentUrl, task }) => ({
          agentUrl,
          contextId: task.contextId,
          taskId: task.id,
        })),
      },
    })
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_COMPLETED)
  }

  async cancelTask(taskId) {
    const run = this.runs.get(taskId)
    if (!run) {
      return
    }
    run.cancelled = true
    await Promise.allSettled(
      run.children.map(({ client, taskId: childTaskId }) =>
        client.cancelTask({ id: childTaskId, tenant: '' })
      )
    )
  }
}

export async function createDataSourceServer({ source, fail = false, port = 0 }) {
  const agentCard = createAgentCard({
    name: `${source} Agent`,
    description: `Provides deterministic ${source} data`,
    url: `http://127.0.0.1:${port}/a2a`,
    skills: [
      {
        id: `fetch-${source.toLowerCase()}`,
        name: `Fetch ${source}`,
        description: `Fetch ${source} data`,
        tags: ['data-source'],
        inputModes: ['text/plain'],
        outputModes: ['application/json'],
      },
    ],
  })
  return createA2AServer({
    agentCard,
    executor: new DataSourceExecutor({ source, fail }),
    port,
  })
}

export async function createServer({ childUrls, port = 0 }) {
  const executor = new FanoutExecutor(childUrls)
  const agentCard = createAgentCard({
    name: 'Fan-out Coordinator Agent',
    description: 'Runs child A2A tasks in parallel and aggregates their artifacts',
    url: `http://127.0.0.1:${port}/a2a`,
    skills: [
      {
        id: 'aggregate-sources',
        name: 'Aggregate sources',
        description: 'Fan out to independent agents and aggregate partial results',
        tags: ['fan-out', 'aggregation'],
        inputModes: ['text/plain'],
        outputModes: ['application/json'],
      },
    ],
  })
  return { ...(await createA2AServer({ agentCard, executor, port })), executor }
}

export async function runClient({ agentUrl, query }) {
  const client = await new ClientFactory().createFromUrl(agentUrl)
  return client.sendMessage(
    createSendRequest(createMessage({ parts: [textPart(query)] }), {
      returnImmediately: false,
      acceptedOutputModes: ['application/json'],
    })
  )
}

export async function runDemo() {
  const sources = await Promise.all([
    createDataSourceServer({ source: 'Alpha' }),
    createDataSourceServer({ source: 'Beta' }),
    createDataSourceServer({ source: 'Gamma', fail: true }),
  ])
  let coordinator
  try {
    const childUrls = await Promise.all(sources.map(startServer))
    coordinator = await createServer({ childUrls })
    const coordinatorUrl = await startServer(coordinator)
    const task = await runClient({ agentUrl: coordinatorUrl, query: 'collect status' })
    const aggregate = firstPart(task.artifacts[0], 'data')
    console.log(`[07] Successful sources: ${aggregate.results.length}`)
    console.log(`[07] Missing sources: ${aggregate.missing.length}`)
    return { task, runs: coordinator.executor.runs }
  } finally {
    await stopServers(coordinator?.server, ...sources.map(({ server }) => server))
  }
}
