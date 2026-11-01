import { TaskState } from '@a2a-js/sdk'
import { ClientFactory } from '@a2a-js/sdk/client'
import { RequestMalformedError } from '@a2a-js/sdk/errors'
import { z } from 'zod'

import {
  createAgentCard,
  createMessage,
  createSendRequest,
  dataPart,
  firstPart,
  publishArtifact,
  publishStatus,
  publishTask,
} from '../../src/lib/a2a-builders.js'
import { createA2AServer, startServer, stopServers } from '../../src/lib/create-server.js'
import { withMessageValidation } from '../../src/lib/validation.js'

export const workRequestSchema = z.object({
  title: z.string().trim().min(1),
  items: z.array(z.string().trim().min(1)).min(1),
})

class NormalizerExecutor {
  async execute(requestContext, eventBus) {
    const input = workRequestSchema.parse(firstPart(requestContext.userMessage, 'data'))
    publishTask(eventBus, requestContext)
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_WORKING, 'Normalizing request')
    publishArtifact(eventBus, requestContext, {
      name: 'normalized-work-request',
      parts: [
        dataPart({
          title: input.title.trim(),
          items: input.items.map((item, index) => ({ order: index + 1, value: item.trim() })),
        }),
      ],
    })
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_COMPLETED)
  }

  async cancelTask() {}
}

export async function createServer({ port = 0 } = {}) {
  const agentCard = createAgentCard({
    name: 'Request Normalizer Agent',
    description: 'Turns a generic work request into a canonical artifact',
    url: `http://127.0.0.1:${port}/a2a`,
    skills: [
      {
        id: 'normalize-work-request',
        name: 'Normalize work request',
        description: 'Validate and normalize structured work items',
        tags: ['normalize', 'structured-data'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],
  })
  const validate = (message) => {
    const result = workRequestSchema.safeParse(firstPart(message, 'data'))
    if (!result.success) {
      throw new RequestMalformedError({
        message: 'The data Part is not a valid work request',
        metadata: { issues: JSON.stringify(result.error.issues) },
      })
    }
  }
  return createA2AServer({
    agentCard,
    executor: new NormalizerExecutor(),
    port,
    requestHandlerDecorator: (handler) => withMessageValidation(handler, validate),
  })
}

export async function runClient({ agentUrl, input }) {
  const client = await new ClientFactory().createFromUrl(agentUrl)
  return client.sendMessage(
    createSendRequest(createMessage({ parts: [dataPart(input)] }), {
      acceptedOutputModes: ['application/json'],
      returnImmediately: false,
    })
  )
}

export async function runDemo() {
  const agent = await createServer()
  try {
    const url = await startServer(agent)
    const task = await runClient({
      agentUrl: url,
      input: { title: ' Prepare release ', items: [' Test ', ' Publish '] },
    })
    console.log(`[02] Task state: ${task.status.state}`)
    console.log(`[02] Artifact: ${JSON.stringify(firstPart(task.artifacts[0], 'data'))}`)
    return task
  } finally {
    await stopServers(agent.server)
  }
}
