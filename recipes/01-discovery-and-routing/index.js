import { Role } from '@a2a-js/sdk'
import { ClientFactory, ClientFactoryOptions, JsonRpcTransportFactory } from '@a2a-js/sdk/client'
import { AgentEvent } from '@a2a-js/sdk/server'

import {
  createAgentCard,
  createMessage,
  createSendRequest,
  firstPart,
  textPart,
} from '../../src/lib/a2a-builders.js'
import { createA2AServer, startServer, stopServers } from '../../src/lib/create-server.js'

const factory = new ClientFactory(
  ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    transports: [new JsonRpcTransportFactory()],
    preferredTransports: ['JSONRPC'],
  })
)

class TextSkillExecutor {
  constructor(transform) {
    this.transform = transform
  }

  async execute(requestContext, eventBus) {
    const input = firstPart(requestContext.userMessage, 'text') ?? ''
    eventBus.publish(
      AgentEvent.message(
        createMessage({
          role: Role.ROLE_AGENT,
          contextId: requestContext.contextId,
          parts: [textPart(this.transform(input))],
        })
      )
    )
  }

  async cancelTask() {}
}

export async function createServer({ port = 0, name, skillId, tags, transform }) {
  const agentCard = createAgentCard({
    name,
    description: `Deterministic ${skillId} agent`,
    url: `http://127.0.0.1:${port}/a2a`,
    skills: [
      {
        id: skillId,
        name: skillId,
        description: `Apply the ${skillId} text operation`,
        tags,
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
      },
    ],
  })

  return createA2AServer({
    agentCard,
    executor: new TextSkillExecutor(transform),
    port,
  })
}

export async function discoverAgents(baseUrls) {
  return Promise.all(
    baseUrls.map(async (baseUrl) => {
      const client = await factory.createFromUrl(baseUrl)
      const card = await client.getAgentCard()
      return { baseUrl, card, client }
    })
  )
}

export function routeToSkill(agents, skillId) {
  const match = agents.find(({ card }) => card.skills.some((skill) => skill.id === skillId))
  if (!match) {
    throw new Error(`No discovered agent advertises skill "${skillId}"`)
  }
  return match
}

export async function runClient({ baseUrls, skillId, text }) {
  const agents = await discoverAgents(baseUrls)
  const selected = routeToSkill(agents, skillId)
  const result = await selected.client.sendMessage(
    createSendRequest(createMessage({ parts: [textPart(text)] }))
  )
  return { selected: selected.card.name, result }
}

export async function runDemo() {
  const upper = await createServer({
    name: 'Uppercase Agent',
    skillId: 'uppercase-text',
    tags: ['text', 'uppercase'],
    transform: (text) => text.toUpperCase(),
  })
  const count = await createServer({
    name: 'Word Count Agent',
    skillId: 'count-words',
    tags: ['text', 'count'],
    transform: (text) => String(text.trim().split(/\s+/).filter(Boolean).length),
  })

  try {
    const urls = await Promise.all([startServer(upper), startServer(count)])
    const output = await runClient({
      baseUrls: urls,
      skillId: 'uppercase-text',
      text: 'agents discover capabilities',
    })
    console.log(`[01] Routed to ${output.selected}`)
    console.log(`[01] Result: ${firstPart(output.result, 'text')}`)
    return output
  } finally {
    await stopServers(upper.server, count.server)
  }
}
