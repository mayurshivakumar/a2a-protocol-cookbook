import { TaskState } from '@a2a-js/sdk'
import { ClientFactory } from '@a2a-js/sdk/client'
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

const candidateSchema = z.object({
  name: z.string().min(1),
  qualityScore: z.number().min(0).max(100),
})

class ValidationExecutor {
  async execute(requestContext, eventBus) {
    const candidate = candidateSchema.parse(firstPart(requestContext.userMessage, 'data'))
    const violations =
      candidate.qualityScore < 70
        ? [{ rule: 'minimum-quality', detail: 'qualityScore must be at least 70', blocking: true }]
        : []

    publishTask(eventBus, requestContext)
    publishArtifact(eventBus, requestContext, {
      name: 'validation-report',
      parts: [
        dataPart({
          verdict: violations.length ? 'rejected' : 'approved',
          candidate,
          violations,
          resolvedReferenceTaskIds: (requestContext.referenceTasks ?? []).map(({ id }) => id),
        }),
      ],
    })
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_COMPLETED)
  }

  async cancelTask() {}
}

export async function createServer({ port = 0 } = {}) {
  const agentCard = createAgentCard({
    name: 'Validation Gate Agent',
    description: 'Returns an approval or a structured rejection report',
    url: `http://127.0.0.1:${port}/a2a`,
    skills: [
      {
        id: 'validate-candidate',
        name: 'Validate candidate',
        description: 'Apply a deterministic policy gate',
        tags: ['gate', 'validation'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],
  })
  return createA2AServer({ agentCard, executor: new ValidationExecutor(), port })
}

export function presentApprovedArtifact(task) {
  const report = firstPart(task.artifacts[0], 'data')
  if (report.verdict !== 'approved') {
    throw new Error('Gate rejected the candidate; do not present it as approved')
  }
  return report.candidate
}

export async function runClient({ agentUrl }) {
  const client = await new ClientFactory().createFromUrl(agentUrl)
  const rejected = await client.sendMessage(
    createSendRequest(
      createMessage({ parts: [dataPart({ name: 'candidate-v1', qualityScore: 55 })] })
    )
  )
  const approved = await client.sendMessage(
    createSendRequest(
      createMessage({
        contextId: rejected.contextId,
        referenceTaskIds: [rejected.id],
        parts: [dataPart({ name: 'candidate-v2', qualityScore: 85 })],
      })
    )
  )
  return { rejected, approved, presented: presentApprovedArtifact(approved) }
}

export async function runDemo() {
  const agent = await createServer()
  try {
    const url = await startServer(agent)
    const result = await runClient({ agentUrl: url })
    console.log(`[08] First verdict: ${firstPart(result.rejected.artifacts[0], 'data').verdict}`)
    console.log(`[08] Refinement created a new task: ${result.rejected.id !== result.approved.id}`)
    return result
  } finally {
    await stopServers(agent.server)
  }
}
