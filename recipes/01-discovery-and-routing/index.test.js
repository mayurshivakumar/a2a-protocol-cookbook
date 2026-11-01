import { afterEach, describe, expect, it } from 'vitest'

import { firstPart } from '../../src/lib/a2a-builders.js'
import { startServer, stopServers } from '../../src/lib/create-server.js'
import { createServer, discoverAgents, routeToSkill, runClient } from './index.js'

const servers = []

afterEach(async () => stopServers(...servers.splice(0)))

describe('discovery and routing', () => {
  it('discovers cards and routes by advertised skill', async () => {
    const upper = await createServer({
      name: 'Upper',
      skillId: 'uppercase-text',
      tags: ['text'],
      transform: (text) => text.toUpperCase(),
    })
    const count = await createServer({
      name: 'Count',
      skillId: 'count-words',
      tags: ['text'],
      transform: (text) => String(text.split(/\s+/).length),
    })
    servers.push(upper.server, count.server)
    const urls = await Promise.all([startServer(upper), startServer(count)])

    const output = await runClient({ baseUrls: urls, skillId: 'uppercase-text', text: 'hello a2a' })
    expect(output.selected).toBe('Upper')
    expect(firstPart(output.result, 'text')).toBe('HELLO A2A')

    const discovered = await discoverAgents(urls)
    expect(() => routeToSkill(discovered, 'missing-skill')).toThrow(/No discovered agent/)
  })
})
