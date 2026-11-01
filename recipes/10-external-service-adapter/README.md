# 10 — External-service adapter

An ordinary REST API can become an A2A skill without exposing provider details upstream. This recipe
runs a local Hapi provider and a separate A2A adapter agent.

```mermaid
sequenceDiagram
    participant C as A2A client
    participant A as Adapter Agent
    participant P as REST provider
    C->>A: SendMessage(record key)
    A->>P: GET /records/key + provider credential
    P-->>A: provider JSON
    A->>A: Zod validation and TTL cache
    A-->>C: completed Task + Artifact
```

Run `npm run cookbook -- 10`. Repeating the same A2A request still creates a new task, but the adapter
serves its business data from cache. Provider credentials remain inside the adapter process.

The mock exposes deterministic 429, 503, and slow paths. The agent maps them to `FAILED` task statuses
with retry metadata instead of leaking raw HTTP responses or retrying blindly.
