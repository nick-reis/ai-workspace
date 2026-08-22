# ADR 0001: Use a canonical node graph with typed extensions

- Status: Accepted for V1
- Date: 2026-08-12

## Context

The product needs notes, future tasks, events, conversations, memories, projects, workouts, and other meaningful objects to participate in one traversable graph. Markdown links alone cannot enforce cross-domain identity or relationship semantics. A registry layered over separate module records would make retrofitting easier but would introduce polymorphic references and duplicate identities in a new project.

The design must remain understandable, work with Supabase/PostgreSQL and RLS, support purpose-built module interfaces, and give an AI bounded typed operations rather than direct SQL.

## Decision

Use `nodes` as the canonical identity table for every graph-addressable entity and `edges` as the canonical semantic relationship table. Keep shared searchable fields on the node. Add one-to-one type extension tables only when a type requires structured, validated domain data. Store relationship definitions explicitly and store provenance in first-class assertions as refined by ADR 0002.

Markdown notes use a `notes` extension row. Wiki-link mentions are reconciled into Markdown assertions supporting canonical edges. Other provenance sources remain independent.

## Consequences

Positive:

- All edges have real foreign keys and one stable identity system.
- Cross-type backlinks, traversal, search, audit, and RLS share one model.
- Module UIs can remain purpose-built.
- The AI tool surface can be small and typed.
- PostgreSQL remains the single operational source of truth.

Costs and risks:

- Node type and extension consistency needs server-side enforcement.
- `nodes.properties` could become an unvalidated dumping ground unless disciplined.
- Very deep or massive graph analytics may outgrow recursive PostgreSQL queries.
- A universal graph can become noisy if every low-value record is promoted to a node.

## Guardrails

- Apply the meaningful-entity rule before adding node types.
- Keep the relationship vocabulary reviewed and small.
- Bound every traversal.
- Add typed extension fields when they need constraints or queries.
- Measure before considering a dedicated graph database.
- Do not equate semantic similarity with a durable relationship.

## Revisit when

- A real module cannot maintain its invariants with a canonical node plus extension.
- Measured traversal workloads exceed PostgreSQL despite appropriate indexes and bounded queries.
- Multi-user/shared-workspace requirements require a broader authorization model than `owner_id`.
