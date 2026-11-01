# 04 — Long-running multi-turn task

This recipe submits work with `returnImmediately: true`, polls it with `GetTask`, receives an
`INPUT_REQUIRED` interruption, and sends the missing value on the same active task.

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Approval Agent
    C->>S: SendMessage(returnImmediately=true)
    S-->>C: Task(SUBMITTED)
    loop poll
        C->>S: GetTask(taskId)
        S-->>C: current Task
    end
    S-->>C: Task(INPUT_REQUIRED)
    C->>S: SendMessage(taskId, contextId, approval data)
    S-->>C: Task(COMPLETED) + Artifact
```

Run `npm run cookbook -- 04`. The follow-up preserves both IDs and adds another Message to task
history. A bad approval demonstrates terminal `REJECTED`; a completed, failed, canceled, or rejected
task cannot receive another turn.
