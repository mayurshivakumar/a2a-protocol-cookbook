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
} from '../../src/lib/a2a-builders.js'
import { createA2AServer, startServer, stopServers } from '../../src/lib/create-server.js'

class ApprovalExecutor {
  async execute(requestContext, eventBus) {
    const input = firstPart(requestContext.userMessage, 'data') ?? {}

    if (!requestContext.task) {
      publishTask(eventBus, requestContext)
      await sleep(30)
      publishStatus(eventBus, requestContext, TaskState.TASK_STATE_WORKING, 'Checking request')
      await sleep(30)
      publishStatus(
        eventBus,
        requestContext,
        TaskState.TASK_STATE_INPUT_REQUIRED,
        'Provide approvalCode to continue'
      )
      return
    }

    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_WORKING, 'Applying approval')
    if (input.approvalCode !== 'APPROVED') {
      publishStatus(
        eventBus,
        requestContext,
        TaskState.TASK_STATE_REJECTED,
        'The supplied approval code was rejected'
      )
      return
    }

    publishArtifact(eventBus, requestContext, {
      name: 'approved-work',
      parts: [dataPart({ operation: input.operation ?? 'generic-operation', approved: true })],
    })
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_COMPLETED)
  }

  async cancelTask() {}
}

export async function createServer({ port = 0 } = {}) {
  const agentCard = createAgentCard({
    name: 'Approval Workflow Agent',
    description: 'Pauses a long-running task until a client supplies required input',
    url: `http://127.0.0.1:${port}/a2a`,
    streaming: true,
    skills: [
      {
        id: 'run-approved-work',
        name: 'Run approved work',
        description: 'Run work after an approval-code interaction',
        tags: ['async', 'multi-turn', 'input-required'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],
  })
  return createA2AServer({ agentCard, executor: new ApprovalExecutor(), port })
}

async function waitForState(client, taskId, wantedStates) {
  while (true) {
    const task = await client.getTask({ id: taskId, tenant: '', historyLength: 20 })
    if (wantedStates.includes(task.status.state)) {
      return task
    }
    await sleep(20)
  }
}

export async function runClient({ agentUrl }) {
  const client = await new ClientFactory().createFromUrl(agentUrl)
  const submitted = await client.sendMessage(
    createSendRequest(createMessage({ parts: [dataPart({ operation: 'publish-result' })] }), {
      acceptedOutputModes: ['application/json'],
      returnImmediately: true,
    })
  )
  const paused = await waitForState(client, submitted.id, [TaskState.TASK_STATE_INPUT_REQUIRED])
  const completed = await client.sendMessage(
    createSendRequest(
      createMessage({
        taskId: paused.id,
        contextId: paused.contextId,
        parts: [dataPart({ operation: 'publish-result', approvalCode: 'APPROVED' })],
      }),
      { returnImmediately: false, acceptedOutputModes: ['application/json'] }
    )
  )
  return { submitted, paused, completed }
}

export async function runDemo() {
  const agent = await createServer()
  try {
    const url = await startServer(agent)
    const result = await runClient({ agentUrl: url })
    console.log(
      `[04] States: ${result.submitted.status.state} -> ${result.paused.status.state} -> ${result.completed.status.state}`
    )
    console.log(`[04] Continued task: ${result.submitted.id === result.completed.id}`)
    return result
  } finally {
    await stopServers(agent.server)
  }
}
