import { TaskState, generateAgentCardSignature, verifyAgentCardSignature } from '@a2a-js/sdk'
import { ClientFactory, DefaultAgentCardResolver, ServiceParameters } from '@a2a-js/sdk/client'

import { HttpAuthenticationError } from '../../src/lib/auth.js'
import {
  createAgentCard,
  createMessage,
  createSendRequest,
  publishArtifact,
  publishStatus,
  publishTask,
  textPart,
} from '../../src/lib/a2a-builders.js'
import { createA2AServer, startServer, stopServers } from '../../src/lib/create-server.js'

const API_KEY = 'cookbook-api-key'
const KEY_ID = 'cookbook-signing-key'

class AuthenticatedUser {
  constructor(userName) {
    this.userName = userName
    this.isAuthenticated = true
  }
}

class SecureExecutor {
  async execute(requestContext, eventBus) {
    publishTask(eventBus, requestContext)
    publishArtifact(eventBus, requestContext, {
      name: 'secure-result',
      parts: [textPart(`Authenticated as ${requestContext.context.user.userName}`)],
    })
    publishStatus(eventBus, requestContext, TaskState.TASK_STATE_COMPLETED)
  }

  async cancelTask() {}
}

function apiKeySecurityScheme() {
  return {
    scheme: {
      $case: 'apiKeySecurityScheme',
      value: {
        description: 'Cookbook API key',
        location: 'header',
        name: 'X-Api-Key',
      },
    },
  }
}

export async function createServer({ port = 0 } = {}) {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  Object.assign(publicJwk, { kid: KEY_ID, alg: 'ES256', use: 'sig' })

  const securityRequirements = [{ schemes: { cookbookApiKey: { list: [] } } }]
  const agentCard = createAgentCard({
    name: 'Secure Agent',
    description: 'Demonstrates authenticated A2A calls and trusted Agent Cards',
    url: `http://127.0.0.1:${port}/a2a`,
    extendedAgentCard: true,
    securitySchemes: { cookbookApiKey: apiKeySecurityScheme() },
    securityRequirements,
    skills: [
      {
        id: 'secure-operation',
        name: 'Secure operation',
        description: 'Return an authenticated result',
        tags: ['security'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
        securityRequirements,
      },
    ],
  })
  const extendedAgentCard = structuredClone(agentCard)
  extendedAgentCard.description = 'Authenticated card with privileged operational limits'
  extendedAgentCard.skills.push({
    id: 'privileged-limits',
    name: 'Privileged limits',
    description: 'Authenticated-only capability details',
    tags: ['security', 'extended-card'],
    examples: [],
    inputModes: ['application/json'],
    outputModes: ['application/json'],
    securityRequirements,
  })

  let server
  const signatureGenerator = async (card) => {
    const signer = generateAgentCardSignature(keyPair.privateKey, {
      alg: 'ES256',
      kid: KEY_ID,
      typ: 'JOSE',
      jku: `${server.info.uri}/.well-known/jwks.json`,
    })
    return signer(card)
  }
  const authenticate = async (request) => {
    if (request.headers['x-api-key'] !== API_KEY) {
      throw new HttpAuthenticationError('A valid X-Api-Key header is required', 'ApiKey')
    }
    return new AuthenticatedUser('cookbook-client')
  }

  const agent = await createA2AServer({
    agentCard,
    executor: new SecureExecutor(),
    port,
    extendedAgentCard,
    signatureGenerator,
    authenticate,
  })
  server = agent.server
  server.route({
    method: 'GET',
    path: '/.well-known/jwks.json',
    handler: () => ({ keys: [publicJwk] }),
  })
  return { ...agent, publicJwk }
}

export function createCardVerifier() {
  return verifyAgentCardSignature(async (kid, jku) => {
    if (!jku) {
      throw new Error('Signed card did not declare a JWKS URL')
    }
    const response = await fetch(jku)
    const { keys } = await response.json()
    const key = keys.find((candidate) => candidate.kid === kid)
    if (!key) {
      throw new Error(`JWKS does not contain key ${kid}`)
    }
    return key
  })
}

export async function runClient({ agentUrl }) {
  const resolver = new DefaultAgentCardResolver()
  const signedCard = await resolver.resolve(agentUrl)
  const verifier = createCardVerifier()
  await verifier(signedCard)

  const tamperedCard = structuredClone(signedCard)
  tamperedCard.name = 'Tampered Agent'
  let tamperRejected = false
  const originalDebug = console.debug
  try {
    // The SDK logs each failed signature candidate at debug level. This
    // failure is expected, so keep the runnable recipe output focused.
    console.debug = () => {}
    await verifier(tamperedCard)
  } catch {
    tamperRejected = true
  } finally {
    console.debug = originalDebug
  }

  const client = await new ClientFactory().createFromAgentCard(signedCard)
  const serviceParameters = ServiceParameters.createFrom({ 'X-Api-Key': API_KEY })
  const extendedCard = await client.getAgentCard({ serviceParameters }, verifier)
  const task = await client.sendMessage(
    createSendRequest(createMessage({ parts: [textPart('Run securely')] })),
    { serviceParameters }
  )

  const badVersionResponse = await fetch(`${agentUrl}/a2a`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'A2A-Version': '9.9',
      'X-Api-Key': API_KEY,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetTask', params: { id: task.id } }),
  })
  const badVersion = await badVersionResponse.json()

  return { signedCard, extendedCard, task, tamperRejected, badVersion }
}

export async function runDemo() {
  const agent = await createServer()
  try {
    const url = await startServer(agent)
    const result = await runClient({ agentUrl: url })
    console.log(`[11] Card signatures: ${result.signedCard.signatures.length}`)
    console.log(`[11] Tampered card rejected: ${result.tamperRejected}`)
    console.log(`[11] Extended skills: ${result.extendedCard.skills.length}`)
    console.log(`[11] Bad version error: ${result.badVersion.error.message}`)
    return result
  } finally {
    await stopServers(agent.server)
  }
}
