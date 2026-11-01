import { afterEach, describe, expect, it } from 'vitest'

import { firstPart } from '../../src/lib/a2a-builders.js'
import { startServer, stopServers } from '../../src/lib/create-server.js'
import { createServer, presentApprovedArtifact, runClient } from './index.js'

let server

afterEach(async () => stopServers(server))

describe('validation and refinement gate', () => {
  it('blocks a rejection and approves a new referenced task', async () => {
    const agent = await createServer()
    server = agent.server
    const url = await startServer(agent)
    const result = await runClient({ agentUrl: url })
    const rejectedReport = firstPart(result.rejected.artifacts[0], 'data')
    const approvedReport = firstPart(result.approved.artifacts[0], 'data')

    expect(() => presentApprovedArtifact(result.rejected)).toThrow(/Gate rejected/)
    expect(result.approved.id).not.toBe(result.rejected.id)
    expect(result.approved.contextId).toBe(result.rejected.contextId)
    expect(rejectedReport.verdict).toBe('rejected')
    expect(approvedReport.verdict).toBe('approved')
    expect(approvedReport.resolvedReferenceTaskIds).toEqual([result.rejected.id])
  })
})
