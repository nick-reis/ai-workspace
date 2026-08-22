# Development guide

## Prerequisites

- Node.js 20 or newer and npm
- Rust stable with Cargo
- Tauri 2 platform prerequisites for the target OS
- A Supabase project when backend work begins

## Commands

```bash
npm install
npm run dev
npm run tauri dev
npm run build
npm run test
npm run test:watch
npx supabase db push --dry-run --linked
npx supabase test db --linked
npx supabase db push --linked
npx supabase functions deploy graph-chat
```

`npm run dev` starts only the Vite frontend. `npm run tauri dev` starts Vite through the Tauri shell.

## Environment variables

Copy `.env.example` to `.env.local`:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Only variables prefixed with `VITE_` are embedded in the client. The Supabase anon key is intended for clients when RLS is correctly enabled; it is not a substitute for RLS.

Set the OpenAI key and any Supabase service-role key as Edge Function secrets. Never put either one in `.env.local` under a `VITE_` name.

The project uses a hosted-only Supabase workflow. Every database change is a timestamped migration; do not make schema changes directly in the dashboard. `OPENAI_API_KEY` and optional `OPENAI_MODEL` are hosted Edge Function secrets.

## Dependency roles

| Dependency | Role |
| --- | --- |
| `cytoscape` | Interactive graph rendering and built-in layout |
| `@supabase/supabase-js` | Authenticated data and function client |
| `@tanstack/react-query` | Server state, caching, and mutation invalidation |
| `react-router-dom` | Application navigation and node deep links |
| `zustand` | Small cross-component UI state only |
| `zod` | Runtime boundary and tool schema validation |
| `tailwindcss` + shadcn foundations | Styling and accessible component composition |
| `lucide-react` | Icons |
| `gsap` | Selective high-value motion; avoid graph-layout animation conflicts |
| `vitest` + Testing Library | Unit and React behavior tests |

## Suggested source layout

Create folders as implementation requires them; do not scaffold empty architecture.

```text
src/
  app/              composition, routes, providers
  components/       reusable UI primitives
  features/
    graph/           graph canvas and interaction
    nodes/           browser, editor, inspector
    chat/            chat and evidence/change review
  lib/               Supabase client and shared utilities
  stores/            client-only Zustand stores
  types/             shared frontend domain types
supabase/
  migrations/        schema, functions, RLS, seeds
  functions/         AI orchestrator
```

## Boundary conventions

- Database rows are snake_case; frontend domain objects may be camelCase after one explicit mapping layer.
- Stable node/edge IDs cross every boundary. Titles are display and search fields, not identities.
- Parse unknown network/function responses with Zod before use.
- Query keys live near a feature's graph client, not scattered through components.
- Cytoscape elements are derived view models; never make them the persisted domain model.
- Treat archives as recoverable lifecycle changes. Hard deletion is a later retention decision.

## Testing priorities

1. Database constraints and RLS policies.
2. Relationship semantics, inverse rendering, and symmetric canonicalization.
3. Traversal limits and correct path output.
4. Wiki-link resolution/reconciliation.
5. AI tool schema validation and approval state transitions.
6. Critical UI flows and evidence/change rendering.

Mock the model provider at the typed boundary for deterministic tests. Maintain a smaller opt-in integration evaluation against the real provider for tool behavior and retrieval quality.

## Definition of done for a graph feature

- The operation has typed inputs and outputs.
- Authorization and graph invariants are enforced server-side.
- Loading, empty, error, conflict, and ambiguity states are handled.
- The visible graph and inspector agree on direction, type, and provenance.
- Mutations are auditable and invalidate the correct cached views.
- Relevant tests pass and the production frontend build succeeds.
