# AI Workspace

AI Workspace is a personal AI system built around one inspectable graph. V1 exposes notes, durable conversations, and explicitly approved AI-proposed Memories; projects, tasks, people, topics, and other domain objects remain deferred until they have purpose-built interfaces and constraints.

The first milestone is intentionally narrow: prove that a person and an AI can create, inspect, visualize, and traverse the same graph reliably. Tasks, calendars, fitness, voice, background agents, and other modules wait until that loop works.

## V1 product loop

1. Create or edit a node.
2. Connect it to another node with a typed edge.
3. See the change immediately in the graph.
4. Ask the AI a question.
5. Watch the AI search and traverse the graph through validated tools.
6. Review every graph mutation the AI proposes or performs.

## Stack

- Tauri 2, React 19, TypeScript, and Vite
- Tailwind CSS
- A retained Graph renderer with worker physics and WebGL/Canvas rendering
- React Router, TanStack Query, and Zod
- Supabase: PostgreSQL, Auth, RLS, Edge Functions, Storage, and later pgvector
- OpenAI Responses API from server-side Edge Functions only

## Documentation

- [Product vision and boundaries](docs/PRODUCT.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Database and graph model](docs/DATA_MODEL.md)
- [AI graph protocol](docs/AI_GRAPH_PROTOCOL.md)
- [Relationship semantic contract](docs/RELATIONSHIP_CONTRACT.md)
- [Engineering standards](docs/ENGINEERING_STANDARDS.md)
- [App-wide audit (2026-08-20)](docs/AUDIT_2026-08-20.md)
- [V1 roadmap and acceptance criteria](docs/V1_ROADMAP.md)
- [Retired frontend inventory](docs/RETIRED_FRONTEND_INVENTORY.md)
- [Local development](docs/DEVELOPMENT.md)
- [ADR 0001: canonical node graph](docs/decisions/0001-canonical-node-graph.md)
- [ADR 0002: semantic edges and supporting assertions](docs/decisions/0002-separate-edges-from-assertions.md)

## Getting started

Prerequisites: Node.js 20+, npm, Rust stable, and the platform prerequisites listed by Tauri.

```bash
npm install
npm run dev
```

Run the desktop app:

```bash
npm run tauri dev
```

Validate the frontend:

```bash
npm run build
npm run test
```

Copy `.env.example` to `.env.local` when a Supabase project is connected. Never place an OpenAI API key in a `VITE_` variable or in the desktop bundle.

Configure AI chat as a hosted Supabase secret, then redeploy the function:

```bash
npx supabase secrets set OPENAI_API_KEY=your-key
npx supabase functions deploy graph-chat
```

## Current status

The previous product frontend has been retired for a ground-up rebuild. The root
route now contains only the new dark theme and animated shadcn sidebar
foundation. The retained graph renderer is available from the sidebar as
`Graph` at `#/graph`. The Supabase backend, graph model, migrations, Edge
Functions, and related architecture documentation remain in place.
