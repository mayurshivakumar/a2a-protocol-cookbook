import { A2A_PROTOCOL_VERSION, Role, TaskState } from '@a2a-js/sdk'
import { AgentEvent } from '@a2a-js/sdk/server'

export function textPart(text, metadata) {
  return {
    content: { $case: 'text', value: text },
    metadata,
    filename: '',
    mediaType: 'text/plain',
  }
}

export function dataPart(data, metadata) {
  return {
    content: { $case: 'data', value: data },
    metadata,
    filename: '',
    mediaType: 'application/json',
  }
}

export function createMessage({
  parts,
  role = Role.ROLE_USER,
  messageId = crypto.randomUUID(),
  taskId = '',
  contextId = '',
  referenceTaskIds = [],
  metadata,
}) {
  return {
    messageId,
    contextId,
    taskId,
    role,
    parts,
    metadata,
    extensions: [],
    referenceTaskIds,
  }
}

export function createSendRequest(message, configuration) {
  return {
    tenant: '',
    message,
    configuration,
    metadata: {},
  }
}

export function createAgentCard({
  name,
  description,
  url,
  skills,
  streaming = false,
  pushNotifications = false,
  extendedAgentCard = false,
  securitySchemes = {},
  securityRequirements = [],
}) {
  return {
    name,
    description,
    supportedInterfaces: [
      {
        url,
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: '',
      },
    ],
    provider: {
      organization: 'A2A Protocol Cookbook',
      url: 'https://a2a-protocol.org',
    },
    version: '1.0.0',
    capabilities: {
      streaming,
      pushNotifications,
      extendedAgentCard,
      extensions: [],
    },
    securitySchemes,
    securityRequirements,
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: skills.map((skill) => ({
      examples: [],
      inputModes: ['text/plain', 'application/json'],
      outputModes: ['text/plain', 'application/json'],
      securityRequirements: [],
      ...skill,
    })),
    documentationUrl: '',
    signatures: [],
  }
}

export function taskSnapshot(requestContext, state = TaskState.TASK_STATE_SUBMITTED) {
  return (
    requestContext.task ?? {
      id: requestContext.taskId,
      contextId: requestContext.contextId,
      status: {
        state,
        timestamp: new Date().toISOString(),
        message: undefined,
      },
      artifacts: [],
      history: [requestContext.userMessage],
      metadata: requestContext.userMessage.metadata,
    }
  )
}

export function publishTask(eventBus, requestContext, state) {
  const task = taskSnapshot(requestContext, state)
  eventBus.publish(AgentEvent.task(task))
  return task
}

export function publishStatus(eventBus, requestContext, state, messageText, metadata) {
  const message = messageText
    ? createMessage({
        role: Role.ROLE_AGENT,
        parts: [textPart(messageText)],
        taskId: requestContext.taskId,
        contextId: requestContext.contextId,
        metadata,
      })
    : undefined

  eventBus.publish(
    AgentEvent.statusUpdate({
      taskId: requestContext.taskId,
      contextId: requestContext.contextId,
      status: {
        state,
        message,
        timestamp: new Date().toISOString(),
      },
      metadata,
    })
  )
}

export function publishArtifact(
  eventBus,
  requestContext,
  {
    name,
    parts,
    artifactId = crypto.randomUUID(),
    description = '',
    append = false,
    lastChunk = true,
    metadata,
  }
) {
  eventBus.publish(
    AgentEvent.artifactUpdate({
      taskId: requestContext.taskId,
      contextId: requestContext.contextId,
      artifact: {
        artifactId,
        name,
        description,
        parts,
        metadata,
        extensions: [],
      },
      append,
      lastChunk,
      metadata,
    })
  )
  return artifactId
}

export function firstPart(message, kind) {
  return message.parts.find((part) => part.content?.$case === kind)?.content?.value
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
