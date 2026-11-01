# 11 — Security and trust

The public Agent Card declares an API-key security scheme. Credentials travel in HTTP headers, never in
Message Parts. Authenticated clients can call the skill and retrieve the extended Agent Card.

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Secure Agent
    participant J as JWKS endpoint
    C->>S: GET public signed Agent Card
    C->>J: Resolve signing key by kid/jku
    C->>C: Verify JWS over canonical card
    C->>S: GetExtendedAgentCard + X-Api-Key
    S-->>C: signed privileged card
    C->>S: SendMessage + X-Api-Key + A2A-Version: 1.0
    S-->>C: completed secure Task
```

Run `npm run cookbook -- 11`. The card uses ES256 JWS with RFC 8785 canonicalization through the SDK,
and publishes its public key as JWKS. The demo verifies the card, proves that a changed name invalidates
the signature, and refuses protocol version `9.9`.

The keys and API key are ephemeral teaching fixtures. Production deployments need managed key
rotation, trusted JWKS origins, TLS, real identity, authorization, and secret storage.
