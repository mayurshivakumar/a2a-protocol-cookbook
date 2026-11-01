import Hapi from '@hapi/hapi'
import { DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server'

import { registerA2AJsonRpc } from './a2a-hapi.js'

export async function createA2AServer({
  agentCard,
  executor,
  port = 0,
  taskStore = new InMemoryTaskStore(),
  eventBusManager,
  pushNotificationStore,
  pushNotificationSender,
  extendedAgentCard,
  signatureGenerator,
  authenticate,
  requestHandlerDecorator = (handler) => handler,
}) {
  const defaultRequestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    executor,
    eventBusManager,
    pushNotificationStore,
    pushNotificationSender,
    extendedAgentCard,
    signatureGenerator
  )
  const requestHandler = requestHandlerDecorator(defaultRequestHandler)
  const server = Hapi.server({ port, host: '127.0.0.1' })
  registerA2AJsonRpc(server, { requestHandler, authenticate })

  return { server, requestHandler, taskStore, agentCard }
}

export async function startServer(agentOrServer) {
  const server = agentOrServer.server ?? agentOrServer
  await server.start()
  if (agentOrServer.agentCard) {
    agentOrServer.agentCard.supportedInterfaces[0].url = `${server.info.uri}/a2a`
  }
  return server.info.uri
}

export async function stopServers(...servers) {
  await Promise.all(servers.filter(Boolean).map((server) => server.stop()))
}
