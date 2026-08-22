# System architecture

## Decision summary

Use a canonical node graph with typed extensions:

- `nodes` is the universal identity and shared retrieval surface.
- `edges` stores one canonical semantic relationship; `edge_assertions` stores every independent source and provenance claim supporting it.
- `relationship_types` defines deterministic direction, inverse, and symmetry rules.
- Type-specific tables are added only when a domain needs structured fields or constraints.
- Supabase is the cloud source of truth; the client does not implement a custom sync engine.
- The AI uses a small typed graph API through a server-side orchestrator and never receives direct SQL access.

This is a constrained universal-node design. It avoids both extremes: isolated module graphs and a single unvalidated JSON table pretending every domain is identical.

## Logical shape

```text
Tauri application
  React UI
    node browser     graph canvas     AI chat/change review
           \             |             /
            \------ application layer /
                   typed graph client
                          |
                    Supabase API/RPC
                          |
      PostgreSQL + RLS + graph domain functions
                /                    \
       nodes and edges          type extensions
                          |
              Supabase Edge Function
                 AI orchestrator
                          |
             OpenAI Responses API
```

## Layer responsibilities

### React application

- Renders both a complete force-directed workspace graph and focused neighborhoods, plus chat and change review.
- Maintains ephemeral UI state such as selection, filters, panels, and graph viewport.
- Uses TanStack Query for server state and mutation invalidation.
- Uses Zustand only for cross-component client state that is not server data.
- Validates boundary payloads with Zod.
- Does not contain service-role credentials or OpenAI keys.

### Graph application layer

- Provides intention-revealing operations such as `searchNodes`, `getNeighborhood`, and `createEdge`.
- Converts database rows into stable domain types.
- Centralizes query keys, errors, mutation invalidation, and permission-safe calls.
- Keeps renderer-specific Cytoscape types out of the domain model.

### PostgreSQL graph domain

- Enforces ownership, valid endpoints, allowed relationship types, and uniqueness.
- Applies relationship semantics deterministically.
- Returns bounded neighborhoods instead of unbounded recursive results.
- Uses RLS for user isolation.
- Records change provenance and audit details.

### AI orchestrator

- Runs in a Supabase Edge Function.
- Authenticates the user and executes tools under that user's authorization.
- Uses the OpenAI Responses API with a bounded tool loop.
- Exposes typed graph capabilities, not SQL or generic RPC execution.
- Separates read tools from mutating tools.
- Returns an answer, evidence paths, and a structured change set.

## Source-of-truth comparison

### Canonical universal nodes — chosen

Every graph-addressable entity has one row in `nodes`. Shared identity, title, type, summary, timestamps, and ownership are queryable without joining every module. A type-specific table can extend the row using the same ID.

Benefits: simple edge foreign keys, cross-type search, backlinks, RLS, and traversal. Cost: the node row must stay small and cannot become a dumping ground for every module field.

### Graph registry over module records — rejected for the foundation

A registry mapping `(entity_type, entity_id)` gives existing module records a graph identity. It is useful when retrofitting a mature system, but a new brain-first project would inherit polymorphic integrity problems, extra joins, and two identities for every object.

### Markdown-first — rejected as storage architecture

Markdown remains the authoring format for notes. It cannot reliably express task constraints, event times, relationship provenance, permissions, or typed cross-domain integrity. Wiki-links are parsed into edges rather than treated as the graph database.

### Property graph database — deferred

PostgreSQL is sufficient for bounded personal-workspace traversals and keeps Auth, RLS, transactional writes, and operational complexity in one system. Reconsider a dedicated graph database only after measured traversal requirements exceed this model.

## Read path

1. Search node titles, aliases, summaries, note bodies, and embeddings to find candidate anchors.
2. Retrieve a bounded neighborhood using relationship and node-type filters.
3. Rank paths outside the LLM using explicit rules, recency, provenance, and optional semantic relevance.
4. Load detailed content only for the best nodes.
5. Give the LLM compact node summaries, edge facts, selected content, and stable IDs.
6. Return an answer whose evidence can be opened in the UI.

## Write path

1. The user or AI submits a typed mutation intent. AI relationship intents receive a canonical owner/endpoints/type semantic key.
2. Zod validates the tool payload at the Edge Function boundary.
3. Domain code resolves node identities and checks ambiguity.
4. PostgreSQL validates ownership, type rules, and relationship semantics.
5. Relationship approval serializes on that semantic key, reuses canonical support, and supersedes pending equivalents in one transaction.
6. The client invalidates relevant queries and visualizes the exact change.

AI-suggested destructive and substantive content changes require explicit confirmation in V1. Explicit node creation may be auto-applied. AI relationships are proposed for approval so cross-conversation equivalents reconcile visibly. Every request remains in the ledger, and only support created by that action is undoable.

## State ownership

| State | Owner |
| --- | --- |
| Nodes, edges, note content, audit history | Supabase/PostgreSQL |
| Authentication session | Supabase Auth client |
| Server request cache | TanStack Query |
| Selected node, graph filters, panel layout | Zustand/local component state |
| Form state | Local React state |
| AI credentials and provider calls | Supabase Edge Function secrets |

## Security boundaries

- Every graph table includes `owner_id` and RLS policies.
- Edge creation requires ownership or authorized access to both endpoints.
- The anon key is safe to ship only because RLS remains enabled and tested.
- OpenAI and Supabase service-role keys never enter the Vite/Tauri bundle.
- AI tools execute an allowlisted operation with bounded inputs and outputs.
- User-authored node content, imported text, and conversation content are untrusted data, not instructions to the orchestrator.

## Deliberate constraints

- Maximum traversal depth defaults to 2 and is capped at 3 in V1.
- Every traversal has node and edge limits.
- Model rounds and tool calls have separate budgets; cached/parallel reads reduce wasted rounds and the final round is reserved for synthesis.
- Relationship names come from a registry; the AI cannot invent schema silently.
- Semantic similarity produces candidates, not durable edges.
- The default focused view remains bounded. The explicit All graph mode loads every active workspace node and relationship for visual exploration, with local filters and an Obsidian-style force layout.
