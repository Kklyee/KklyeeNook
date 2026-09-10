# KklyeeNook

KklyeeNook manages conversational agent sessions and the executions performed within them.

## Language

**Agent Session**:
A durable conversation that groups messages and Agent Runs.
_Avoid_: Thread, conversation

**Agent Run**:
One durable execution initiated by a prompt within an Agent Session.
_Avoid_: Task, request

**Interrupted Run**:
An Agent Run that was still active when a previous app process ended and whose outcome can no longer be observed.
_Avoid_: Failed Run, aborted Run
