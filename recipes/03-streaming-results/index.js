import { TaskState } from '@a2a-js/sdk'
import { ClientFactory } from '@a2a-js/sdk/client'

import {
  createAgentCard,
  createMessage,
  createSendRequest,
  firstPart,
  publishArtifact,
  publishStatus,
  publishTask,
  sleep,
  textPart,
} from '../../src/lib/a2a-builders.js'
import { createA2AServer, startServer, stopServers } from '../../src/lib/create-server.js'

class StreamingOutlineExecutor {
  async execute(requestContext, eventBus) {
    const topic = firstPart(requestContext.userMessage, 'text') ?? 'A2A'
    publishTask(eventBus, requestContext)
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_WORKING, 'Building outline')

    const artifactId = crypto.randomUUID()
    const chunks = [`Introduction to ${topic}\n`, 'Core concepts\n', 'Operational guidance\n']
    for (const [index, chunk] of chunks.entries()) {
      publishArtifact(eventBus, requestContext, {
        artifactId,
        name: 'outline.txt',
        parts: [textPart(chunk)],
        append: index > 0,
        lastChunk: index === chunks.length - 1,
      })
      await sleep(20)
    }
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_COMPLETED)
  }

  async cancelTask() {}
}

export async function createServer({ port = 0 } = {}) {
  const agentCard = createAgentCard({
    name: 'Streaming Outline Agent',
    description: 'Streams progress and incremental artifact chunks',
    url: `http://127.0.0.1:${port}/a2a`,
    streaming: true,
    skills: [
      {
        id: 'stream-outline',
        name: 'Stream outline',
        description: 'Generate an outline incrementally',
        tags: ['streaming', 'outline'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
    ],
  })
  return createA2AServer({ agentCard, executor: new StreamingOutlineExecutor(), port })
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
  const agent = await createServer()
  try {
    const url = await startServer(agent)
    const events = await runClient({ agentUrl: url, topic: 'agent interoperability' })
    console.log(`[03] Received ${events.length} SSE events`)
    console.log(`[03] Event kinds: ${events.map((event) => event.payload.$case).join(', ')}`)
    return events
  } finally {
    await stopServers(agent.server)
  }
}
