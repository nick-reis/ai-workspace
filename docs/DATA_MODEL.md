# Data and graph model

## Core invariant

Every graph-addressable object has exactly one canonical node ID. Every relationship connects two valid node IDs. Domain-specific records use the node ID as their primary and foreign key.

## Proposed V1 schema

This contract is implemented by the hosted Supabase migrations in `supabase/migrations`.

### `nodes`

| Column | Purpose |
| --- | --- |
| `id uuid primary key` | Stable graph identity |
| `owner_id uuid` | Auth owner and RLS boundary |
| `type text` | Allowlisted node type |
| `title text` | Human-visible name |
| `summary text null` | Compact retrieval representation |
| `version bigint` | Optimistic concurrency version |
| `created_at`, `updated_at` | Lifecycle timestamps |
| `archived_at null` | Recoverable removal from normal views |

`properties` is not a substitute for a domain table. If a field needs validation, indexing, joins, sorting, or lifecycle rules, give it a typed column in an extension table.

Every new node and future rename receives an owner-wide unambiguous active title. If the normalized requested title is already used by any node or alias, the database assigns the first available suffix: `Title (2)`, `Title (3)`, and so on. All node types and both human and AI creation paths share the same advisory lock, preventing simultaneous requests from choosing the same suffix. Existing nodes are not silently renamed by this policy; UUIDs remain the actual identity.

`created_at` and `updated_at` are first-class retrieval metadata, not display-only fields. `created_at` is immutable. Mutations to typed extensions, including note-content edits and every new user or assistant conversation message, touch the parent node's `updated_at` and increment its version. Search may use recency as a modest ranking signal, but it must not outrank strong semantic evidence. Conversation-summary freshness is deliberately independent of this general timestamp.

### `notes`

| Column | Purpose |
| --- | --- |
| `node_id uuid primary key` | Also references `nodes(id)` |
| `markdown text` | Human-authored note body |
| `content_version bigint` | Optimistic concurrency and parsing version |
| `parsed_at timestamptz null` | Last successful wiki-link reconciliation |

The database enforces that the associated node has type `note` through a controlled creation function or trigger.

### `memories`

An approved Memory extends a `memory` node with a global semantic key, kind, canonical statement, confidence, optional explicit expiration, and current revision. `memory_revisions` preserves every approved value, while normalized source rows tie each revision to exact user messages and its AI run. Pending candidates and editable suggested connections live in proposal tables and are audit records, not graph facts. Exact and conservatively typo-matched note-title and alias mentions are resolved owner-locally for proposal connections; semantic similarity alone cannot create Memory-to-Memory support.

Approval serializes the semantic key and atomically creates or updates the Memory, records a revision, applies selected semantic assertions, links the producing or updating conversation, supersedes equivalent pending proposals, and returns the graph delta. Rejection writes no Memory. Undo restores an update through a restoration revision or archives a newly created Memory while retracting only assertions introduced by that approval.

### `relationship_types`

| Column | Purpose |
| --- | --- |
| `name text primary key` | Stable machine name such as `part_of` |
| `label text` | Display label |
| `description text` | Semantics used by people and AI tools |
| `is_symmetric boolean` | Whether A→B implies the same meaning as B→A |
| `inverse_name text null` | Display/query inverse such as `contains` for `part_of` |
| `allowed_source_types text[] null` | Optional source constraint |
| `allowed_target_types text[] null` | Optional target constraint |
| `is_hierarchical`, `must_be_acyclic` | Machine-readable structural invariants |
| `allows_self_reference` | Whether a relationship may connect a node to itself |

V1 starts with a small vocabulary:

- `related_to`: symmetric, intentionally broad.
- `references` / `referenced_by`: directional document reference.
- `part_of` / `contains`: directional hierarchy.
- `about`: directional subject relationship.
- `supports` / `supported_by`: the source contributes evidence, material, or progress toward the target. This is not the same as an `edge_assertion`, which records why the system believes any relationship exists.
- `derived_from` / `source_of`: directional derivation.
- `discusses` / `discussed_in`: a conversation substantially discusses an existing Note; deterministic from an explicit user Note-title mention, an approved relationship involving the Note, or an AI-authored Note update, and never from retrieval, selected UI context, or Memory revisions.
- `produced` / `produced_in`: deterministic creation provenance: a conversation directly caused a new entity to be created; never used for updates.

Adding a relationship type is a reviewed schema/domain decision, not an ad hoc AI action.
The complete overlap and non-example rules live in `RELATIONSHIP_CONTRACT.md`.

### `edges`

| Column | Purpose |
| --- | --- |
| `id uuid primary key` | Stable relationship identity |
| `owner_id uuid` | RLS boundary |
| `source_node_id uuid` | Directed source node |
| `target_node_id uuid` | Directed target node |
| `relationship_type text` | References the relationship registry |
| `created_at`, `updated_at` | Lifecycle timestamps |
| `archived_at null` | Recoverable deletion and history |

Important constraints:

- Source and target cannot be identical unless the relationship type explicitly permits it.
- Both endpoints must belong to the same authorized owner/workspace.
- Symmetric edges are stored once using a canonical endpoint order.
- A live edge is unique by owner, canonical endpoints, and relationship type.
- Inverse relationships are query semantics, not duplicate rows.
- When a more precise live relationship is asserted, active `ai` or `system` support for `related_to` between the same unordered endpoints is retracted. User-authored broad support remains active. No fuzzy equivalence is inferred between precise relationship types.

### `edge_assertions`

An edge is the semantic relationship; an assertion is one independently retractable reason to believe or display it.

| Column | Purpose |
| --- | --- |
| `id`, `owner_id`, `edge_id` | Stable identity, RLS boundary, and supported edge |
| `provenance` | `user`, `markdown`, `ai`, `system`, or `ingestion` |
| `source_node_id`, `source_message_id`, `source_ai_run_id` | Optional inspectable source records |
| `origin_key` | Stable deterministic or idempotent source identity |
| `reason`, `confidence` | Human-readable support and optional bounded confidence |
| `source_locator jsonb` | Wiki-link ranges or imported source coordinates |
| `status`, `retracted_at` | Active/proposed/rejected/retracted lifecycle |

One edge may have many active assertions without appearing multiple times. The edge remains live while at least one assertion is active and is archived after the last support is retracted.

For exact AI relationship intent, one live edge may have at most one active AI assertion. Repeated requests are audit events, not independent evidence.

### `node_aliases`

Aliases support wiki-link resolution and search without overloading titles:

| Column | Purpose |
| --- | --- |
| `node_id uuid` | Referenced node |
| `owner_id uuid` | RLS and scoped uniqueness |
| `alias text` | Alternative human name |
| `normalized_alias text` | Case/spacing normalized lookup key |

An alias can produce multiple candidates. The resolver must surface ambiguity instead of silently linking the wrong node.

### `ai_runs` and `graph_changes`

`ai_runs` records a user request, model/provider identifiers, status, and timestamps without exposing secrets. `graph_changes` records every proposed/applied node or edge mutation with before/after snapshots, actor, approval state, and the run that caused it.

This is the basis of the “Created / Connected / Updated” review panel. It is audit history, not a second graph.

### `relationship_proposals`

Every AI relationship request stores its exact request message/run, canonical semantic key, reason, confidence, and one of `pending`, `approved`, `rejected`, or `superseded`. Approval locks the semantic key, reuses the live edge and active AI assertion when present, and supersedes other pending equivalents. `superseded_by_proposal_id`, `resolved_at`, and `undone_at` keep transitions inspectable without duplicating graph evidence.

### `conversation_summaries`

Each conversation has at most one durable, incrementally refreshed summary record. It stores a concise narrative summary plus private retrieval keywords, decisions, open loops, and salient facts. Retrieval keywords are not displayed as tags and never create graph nodes or relationships. Structured claims cite the exact message IDs that support them.

The record also stores a monotonic through-message sequence, total message count, source hash, summary version, implementation identifier, generation time, and `current`, `stale`, or `error` status. New messages mark it stale. A refresh request is made when the latest message sequence exceeds the saved cursor or when the summary-policy implementation has changed; otherwise the old summary is returned without calling the model. Policy rebuilds and ordinary refreshes process bounded message batches, so identical timestamps or older long conversations cannot skip or reorder messages. Summary commits are serialized per conversation and reject stale cursors; a message arriving during generation therefore cannot be hidden by an older writer. The summary is a retrieval index, not a replacement for the messages; after selecting a conversation, the AI may search its messages and load only a small neighboring window around relevant evidence.

For conversations, `conversation_summaries.summary` is canonical. `nodes.summary` is a transactionally updated, maximum-2,000-character search projection only. The projection cannot replace or independently organize conversation memory.

### Embeddings

`node_content_chunks` stores compact title/summary/note representations refreshed lazily by server-side search:

- `id`, `node_id`, `chunk_index`
- the chunk text or a stable source span
- `content_hash` and embedding model/version
- pgvector embedding

Embeddings find candidate anchor nodes and rank content. They do not create permanent edges automatically. A suggested semantic relationship becomes an edge only after explicit user action, a reviewed AI action, or a deterministic rule.

### Response evidence

Assistant-message `evidence` JSON preserves separate bounded collections for searched node/message candidates, nodes/messages actually used, traversed edges/assertions/paths, cited content versions, conversation-summary versions, and node IDs cited inline. A search result or identity-only explicit reference does not enter the used-node collection merely because it was resolved. Loading, traversing, or changing the entity establishes use; loading Note content records its content version for Sources and later changed-since-answer checks.

`get_message_evidence` resolves those stored identifiers through owner-scoped database rows. The Sources UI groups citations, other used evidence, and unused search candidates independently. Inline `workspace-node:` links are server-validated against the used-node set and canonicalized to the current node title before persistence.

## How future entities participate

| Entity | Node representation | Typed extension | Graph policy |
| --- | --- | --- | --- |
| Note | title, summary, type | Markdown body | Always graph-addressable |
| Task | title, summary, type | status, due date, priority | Graph-addressable when introduced |
| Event | title, summary, type | start/end/time zone | Graph-addressable when meaningful |
| Conversation | title and durable summary | conversation metadata/messages | Every persisted AI conversation is a V1 node |
| Message | normally no node | message row under conversation | Promote only a durable insight/reference |
| Memory | compact fact as node | confidence, scope, source, review date | Only durable behavioral context |
| Workout | workout summary as node | exercises, sets, metrics | One node per meaningful session/plan, not every set |

Only `note`, `conversation`, and `memory` are active node types in V1. Former placeholder `project`, `topic`, and `person` rows are migrated to notes without deleting their graph identity or relationships. Those domain types can return later through explicit migrations when real typed extensions exist.

An authoritative AI `create_node` audit event deterministically adds `produced` from its conversation to the newly created Note or Memory. Existing Notes receive `discusses` from explicit user title mentions, approved relationships involving the Note, and authoritative AI `update_note` events. All paths reconcile to one system assertion for the conversation/Note pair. Retrieval candidates, selected UI context, and Memory revisions remain in their normalized evidence/audit systems and do not become graph relationships.

Memory revisions retain exact message, conversation, and AI-run provenance in `memory_revision_sources`. A Memory update therefore does not create `discusses`, `produced`, or `derived_from`. Historical production is reconciled only when an existing AI run and create-node change directly prove the origin; timestamps, titles, and embedding similarity are never used to guess it.

## Backlinks

A backlink is an incoming-edge query, not separate content:

```text
get edges where target_node_id = current node
join source nodes
render the inverse label from relationship_types
```

For symmetric edges, either endpoint is considered a neighbor. The UI can group backlinks by relationship type and provenance across all node types.

## Wiki-link lifecycle

For note text such as `Testing this in [[Homelab]]`:

1. Parse the target label and source span after the note is saved.
2. Resolve exact title and alias matches within the authorized workspace.
3. If exactly one node matches, ensure one semantic `references` edge and upsert a Markdown assertion with a stable source-note/target `origin_key` and all mention ranges.
4. If none match, show an unresolved link and offer to create or choose a node.
5. If multiple match, show an ambiguity state; do not guess silently.
6. Reconcile on later saves: preserve matching mentions, add new ones, and retract Markdown assertions whose mentions were removed.

User-created or AI-created assertions supporting the same edge remain active when a Markdown mention disappears.

## Traversal query contract

Traversal accepts:

- one or more start node IDs
- maximum depth (default 1, V1 cap 3)
- maximum node and edge counts
- allowed node types and relationship types
- direction: outgoing, incoming, or both
- optional provenance and archive filters

It returns compact node projections, edges, depth, and full paths. Detailed content is fetched separately. This keeps recursive queries bounded and makes the path shown to the user identical to the path available to the AI.
