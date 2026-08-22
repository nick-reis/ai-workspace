# Product vision

## One sentence

Build a personal AI workspace where every meaningful thing can be identified, connected, traversed, and inspected as part of one graph, while each type of thing retains the interface that suits it.

## The problem

Most personal AI products are either a chatbot over disconnected applications or a document search system. Both approaches hide important context:

- A task knows its due date but not the learning, project, person, and conversation that caused it.
- A note can link to another note but cannot naturally link to a workout, event, or structured task.
- An AI retrieves text by similarity but cannot explain the meaningful path between two things.
- AI-created state is often invisible or difficult to audit.

AI Workspace treats connectivity and inspectability as product features, not implementation details.

## Product principles

### One brain, many interfaces

A note can be Markdown. A task can have status and due-date controls. A workout can have sets and charts. They do not need the same storage shape or UI, but every meaningful entity gets a graph identity and can participate in typed relationships.

### The graph is explicit

Connections are semantic edge records with direction and type. Separate assertions record user, Markdown, AI, system, or imported support with provenance and explanation. `[[Wiki Links]]` are one human-friendly way to author assertions; the brackets are not the source of truth.

### The AI traverses before it reads broadly

The application finds likely starting nodes and expands a small, useful neighborhood. Detailed content is loaded only for the selected nodes. The LLM should not receive the entire workspace.

### AI behavior is inspectable

The interface exposes what the AI searched, which relationships it followed, what evidence it used, and exactly what it changed. Domain code validates graph invariants; the LLM supplies semantic judgment.

### Small proof before broad platform

V1 proves node creation, edge creation, graph visualization, traversal, AI answers, and auditable mutation. It is not an early implementation of every future module.

## Target experience

The core workspace has three cooperating surfaces:

- A node browser and inspector for finding and editing individual things.
- An interactive graph for seeing typed nodes, directed relationships, provenance, and neighborhoods.
- AI chat for questions and graph operations.

Example:

1. The user says, “Create a note about BGP and connect it to my Homelab.”
2. The AI resolves the Homelab node, creates a BGP note and an explicit low-risk `related_to` assertion, and records the reason in the activity ledger.
3. The user sees the new node and edge appear in the graph.
4. The user asks, “What is connected to my Homelab?”
5. The AI traverses the graph and answers with node and edge evidence.
6. The user asks, “Why is BGP connected to it?” and can inspect the edge provenance and explanation.

## Meaningful entity rule

Something should become a node when at least one of these is true:

- A user may want to open, reference, or link it directly.
- It has a lifecycle independent of its parent.
- It carries durable meaning for later retrieval or reasoning.
- It can usefully connect multiple parts of the workspace.

Do not create nodes for every paragraph, button click, chat tool call, or transient UI state. Those can be content, audit data, or telemetry.

## Initial node types

V1 supports a deliberately small set:

- `note`: durable Markdown knowledge.
- `conversation`: persistent AI interaction and its durable summary.
- `memory`: an approved, revision-controlled personal fact with exact message provenance.

The architecture can later add `project`, `person`, `topic`, `task`, `event`, `workout`, and other types when their dedicated interfaces and constraints are actually needed. V1 does not keep placeholder domain types merely to demonstrate theoretical extensibility.

## Conversations and messages

Every persisted conversation is a durable V1 node with a conversation extension row. Individual messages remain ordered child records and are not visible graph nodes by default. A durable personal fact becomes a Memory only through a post-turn proposal with exact user-message provenance and explicit approval.

## Memory and knowledge

Knowledge is user-facing content intended to be read and maintained. A Memory is a compact global fact, preference, goal, constraint, or skill used to personalize behavior. Memories are graph-addressable, versioned, sourced to exact user messages, and never written without approval. Chat history and assistant-authored claims are not automatically Memory.

## Explicit non-goals for V1

- Tasks, calendar, learning, gym, CRM, analytics, or dedicated module UIs
- Voice, tray behavior, global shortcuts, and background agents
- Autonomous graph mutation or invisible post-chat organization; post-turn Memory extraction creates reviewable proposals only
- PDF ingestion and large document pipelines
- Offline-first sync or a custom synchronization engine
- A generic plugin framework, event bus, or enterprise abstraction layer
- Fully automatic relationship creation from semantic similarity
- Direct database or arbitrary SQL access for the AI

## Success definition

The prototype succeeds when a user can understand the graph by looking at it, ask questions that are answered through observable traversal, authorize or review AI changes, and explain the core architecture without needing to understand a large hidden retrieval pipeline.
