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
  textPart,
} from '../../src/lib/a2a-builders.js'
import { createA2AServer, startServer, stopServers } from '../../src/lib/create-server.js'

class LookupExecutor {
  async execute(requestContext, eventBus) {
    const query = firstPart(requestContext.userMessage, 'text') ?? ''
    publishTask(eventBus, requestContext)
    publishArtifact(eventBus, requestContext, {
      name: 'lookup-result',
      parts: [dataPart({ query, facts: [`${query} is available`, `${query} is deterministic`] })],
    })
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_COMPLETED)
  }

  async cancelTask() {}
}

class DelegatingExecutor {
  constructor({ downstreamUrl, timeoutMs = 1_000 }) {
    this.downstreamUrl = downstreamUrl
    this.timeoutMs = timeoutMs
    this.correlations = new Map()
  }

  async getClient() {
    this.client ??= await new ClientFactory().createFromUrl(this.downstreamUrl)
    return this.client
  }

  async execute(requestContext, eventBus) {
    const topic = firstPart(requestContext.userMessage, 'text') ?? 'unknown topic'
    publishTask(eventBus, requestContext)
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_WORKING, 'Delegating lookup')

    let lookup
    let degraded = false
    try {
      const client = await this.getClient()
      const child = await client.sendMessage(
        createSendRequest(createMessage({ parts: [textPart(topic)] })),
        { signal: AbortSignal.timeout(this.timeoutMs) }
      )
      lookup = firstPart(child.artifacts[0], 'data')
      this.correlations.set(requestContext.taskId, {
        agentUrl: this.downstreamUrl,
        contextId: child.contextId,
        taskId: child.id,
      })
    } catch (error) {
      degraded = true
      lookup = { query: topic, facts: ['Fallback result'], error: error.message }
    }

    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_WORKING, 'Composing result')
    publishArtifact(eventBus, requestContext, {
      name: 'delegated-result',
      parts: [dataPart({ topic, lookup, degraded })],
      metadata: {
        downstream: this.correlations.get(requestContext.taskId),
      },
    })
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_COMPLETED)
  }

  async cancelTask() {}
}

export async function createLookupServer({ port = 0 } = {}) {
  const agentCard = createAgentCard({
    name: 'Lookup Agent',
    description: 'Simple downstream capability used by a delegating agent',
    url: `http://127.0.0.1:${port}/a2a`,
    skills: [
      {
        id: 'lookup-topic',
        name: 'Lookup topic',
        description: 'Return deterministic facts for a topic',
        tags: ['lookup'],
        inputModes: ['text/plain'],
        outputModes: ['application/json'],
      },
    ],
  })
  return createA2AServer({ agentCard, executor: new LookupExecutor(), port })
}

export async function createServer({ downstreamUrl, port = 0 } = {}) {
  const executor = new DelegatingExecutor({ downstreamUrl })
  const agentCard = createAgentCard({
    name: 'Delegating Composer Agent',
    description: 'Acts as an A2A server upstream and an A2A client downstream',
    url: `http://127.0.0.1:${port}/a2a`,
    streaming: true,
    skills: [
      {
        id: 'compose-with-lookup',
        name: 'Compose with lookup',
        description: 'Delegate a lookup and compose the result',
        tags: ['delegation', 'composition'],
        inputModes: ['text/plain'],
        outputModes: ['application/json'],
      },
    ],
  })
  return { ...(await createA2AServer({ agentCard, executor, port })), executor }
}

export async function runClient({ agentUrl, topic }) {
  const client = await new ClientFactory().createFromUrl(agentUrl)
  const events = []
  for await (const event of client.sendMessageStream(
    createSendRequest(createMessage({ parts: [textPart(topic)] }))
  )) {
    events.push(event)
  }
  return events
}

export async function runDemo() {
  const lookup = await createLookupServer()
  let delegating
  try {
    const lookupUrl = await startServer(lookup)
    delegating = await createServer({ downstreamUrl: lookupUrl })
    const delegatingUrl = await startServer(delegating)
    const events = await runClient({ agentUrl: delegatingUrl, topic: 'A2A delegation' })
    console.log(`[06] Upstream events: ${events.map((event) => event.payload.$case).join(', ')}`)
    console.log(`[06] Correlated downstream tasks: ${delegating.executor.correlations.size}`)
    return { events, correlations: delegating.executor.correlations }
  } finally {
    await stopServers(delegating?.server, lookup.server)
  }
}
