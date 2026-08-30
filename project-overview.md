可以。你来做应用架构的话，我建议我只给你一个**不绑死实现、但边界清晰**的目录骨架。

目标是：

```text
Desktop Pet App
    ↓
Pet Runtime
    ↓
Agent Adapter
    ↓
Pi SDK
```

核心原则只有一个：

> **Pi SDK 只出现在 infrastructure/agent 这一层，不要渗透到 UI 和业务层。**

我建议目录先这样：

```text
desktop-agent-pet/

src/
├── main/
│   ├── index.ts
│   │
│   ├── agent/
│   │   ├── agentService.ts
│   │   ├── piAgentAdapter.ts
│   │   ├── piEventAdapter.ts
│   │   └── agentSession.ts
│   │
│   ├── pet/
│   │   ├── petRuntime.ts
│   │   ├── petStateMachine.ts
│   │   └── petController.ts
│   │
│   ├── tools/
│   │   ├── petSpeak.tool.ts
│   │   ├── petEmote.tool.ts
│   │   └── index.ts
│   │
│   ├── ipc/
│   │   ├── agentIpc.ts
│   │   ├── petIpc.ts
│   │   └── windowIpc.ts
│   │
│   └── window/
│       ├── petWindow.ts
│       └── chatWindow.ts
│
├── renderer/
│   ├── pet/
│   │   ├── Pet.tsx
│   │   ├── PetSprite.tsx
│   │   ├── SpeechBubble.tsx
│   │   └── PetInput.tsx
│   │
│   ├── chat/
│   │   ├── ChatPanel.tsx
│   │   ├── MessageList.tsx
│   │   └── ToolActivity.tsx
│   │
│   ├── settings/
│   │   └── Settings.tsx
│   │
│   └── app/
│       └── App.tsx
│
├── shared/
│   ├── agent/
│   │   ├── agentEvent.ts
│   │   ├── agentState.ts
│   │   └── agentTypes.ts
│   │
│   ├── pet/
│   │   ├── petEvent.ts
│   │   ├── petState.ts
│   │   └── petTypes.ts
│   │
│   └── ipc/
│       └── channels.ts
│
└── preload/
    └── index.ts
```

最重要的是这几层。

### `main/agent`

这里是 **Pi SDK 的隔离层**。

```text
Pi SDK
  ↓
piAgentAdapter
  ↓
agentService
```

比如：

```ts
interface AgentService {
  prompt(text: string): Promise<void>;
  abort(): void;
  subscribe(listener: AgentEventListener): () => void;
}
```

而 `PiAgentAdapter` 去实现它。

以后你想换：

```text
Codex
Claude Code
OpenCode
```

理论上只增加 Adapter。

---

### `main/pet`

这是我认为你产品真正的核心。

不要让 Pet UI 自己判断：

```text
tool_execution_start
agent_end
message_delta
```

应该：

```text
AgentEvent
    ↓
PetRuntime
    ↓
PetState
```

例如：

```text
agent_start
      ↓
thinking

tool_start
      ↓
working

agent_end
      ↓
success
```

所以：

```text
Agent Runtime
和
Pet Runtime
```

应该是两个独立概念。

---

### `main/tools`

这是以后非常有价值的一层。

比如 Agent 主动调用：

```text
pet_speak
pet_emote
pet_move
show_notification
open_app
```

注意这是：

```text
LLM
 ↓
Tool
 ↓
Desktop Pet
```

和事件驱动：

```text
Agent Event
 ↓
Pet State
```

是两个不同方向。

所以不要混在 PetStateMachine 里面。

---

### `shared`

这里特别重要。

Renderer 不要拿 Pi 的原始类型。

比如不要：

```ts
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
```

而是定义自己的：

```ts
export type AgentEvent =
  | {
      type: "started";
    }
  | {
      type: "thinking";
    }
  | {
      type: "text_delta";
      text: string;
    }
  | {
      type: "tool_started";
      tool: string;
    }
  | {
      type: "tool_finished";
      tool: string;
      success: boolean;
    }
  | {
      type: "completed";
    }
  | {
      type: "failed";
      message: string;
    };
```

然后：

```text
Pi Event
   ↓
PiEventAdapter
   ↓
Your AgentEvent
```

这是一条非常重要的 anti-corruption layer。

---

## 整体应用架构可以先定成这样

```text
┌────────────────────────────────────┐
│            Renderer                │
│                                    │
│ Pet UI / Chat UI / Settings        │
└──────────────────┬─────────────────┘
                   │ IPC
                   ▼
┌────────────────────────────────────┐
│              Main                  │
│                                    │
│         Application Layer          │
│                                    │
│ AgentService      PetRuntime        │
└─────────┬──────────────┬───────────┘
          │              │
          │              ▼
          │        PetStateMachine
          │
          ▼
┌────────────────────────────────────┐
│        Infrastructure Layer        │
│                                    │
│ PiAgentAdapter / Pi SDK            │
│ Electron Window / OS APIs          │
└────────────────────────────────────┘
```

也可以更抽象地看：

```text
UI
 ↓
Application
 ↓
Domain
 ↓
Infrastructure
```

其中你的核心 Domain 更偏：

```text
Pet
Agent abstraction
Product events
```

Pi 属于：

```text
Infrastructure
```

---

## Agent 和 Pet 之间我建议只通过 Event 交流

不要：

```ts
pet.setThinking();
```

散落在 AgentService 各处。

而应该：

```text
Pi
 ↓
AgentEvent
 ↓
PetRuntime.handle(event)
 ↓
PetState
```

这样以后你可以单测：

```ts
petRuntime.handle({
  type: "tool_started",
  tool: "bash",
});

expect(petRuntime.state.activity).toBe("working");
```

完全不需要 Pi，也不需要 Electron。

---

## PetState 我建议一开始就拆两个维度

不要只做：

```ts
"idle";
"thinking";
"happy";
"working";
```

因为以后会冲突。

比如 Agent：

```text
正在 working
+
宠物很开心
```

所以更适合：

```ts
type PetState = {
  activity: "idle" | "thinking" | "working" | "waiting";

  emotion: "neutral" | "happy" | "excited" | "sad" | "angry";

  task?: {
    tool?: string;
    text?: string;
  };
};
```

这样：

```text
activity = working
emotion = excited
```

可以同时存在。

---

## 第一版模块依赖最好保持这个方向

```text
renderer
    ↓
shared


main/ipc
    ↓
main/agent
    ↓
shared


main/pet
    ↓
shared


main/agent/piAgentAdapter
    ↓
Pi SDK
```

而不要出现：

```text
shared → Pi SDK
renderer → Pi SDK
petStateMachine → Electron
```

这些都会让后面越来越难拆。

---

## MVP 阶段其实只需要这些文件

如果上面的目录你觉得太多，第一版甚至可以只有：

```text
src/

main/
├── index.ts
├── agentService.ts
├── piAgentAdapter.ts
├── piEventAdapter.ts
├── petRuntime.ts
├── petStateMachine.ts
└── ipc.ts

renderer/
├── Pet.tsx
├── SpeechBubble.tsx
└── App.tsx

shared/
├── agentEvent.ts
└── petState.ts

preload/
└── index.ts
```

等功能真的长出来再拆目录。

我其实更推荐你**从这个小版本开始**，而不是一开始建二三十个文件。

最核心的依赖图只要始终保持：

```text
             Renderer
                │
               IPC
                │
                ▼
           Application
          /           \
         ▼             ▼
 Agent Service      Pet Runtime
      │                  │
      ▼                  ▼
Pi Adapter        Pet StateMachine
      │
      ▼
    Pi SDK
```

这个结构足够支撑你后面加插件、工具、人格、长期记忆、多 Agent，而不会一开始就过度设计。
