# AI graph protocol

## Goal

The AI should reason over the same inspectable graph a user sees. It receives small, typed capabilities and returns evidence and changes that the UI can explain. It does not receive arbitrary database access.

## Tool surface

V1 should expose no more than these operations:

### Read tools

- `graph.search_nodes(query, types?, limit?)`
- `graph.get_node(node_id, include_content?)`
- `graph.get_neighbors(node_id, relationship_types?, direction?, limit?)`
- `graph.traverse(start_node_ids, max_depth, filters, limits)`
- `conversations.get_summary(conversation_id)`
- `conversations.search_messages(conversation_id, query, limit)`
- `conversations.get_message_context(message_id, before, after)`

### Mutation tools

- `notes.create(title, summary?, markdown, idempotency_key)`
- `graph.update_node(node_id, patch, expected_version)`
- `graph.propose_relationship(source_node_id, target_node_id, relationship_type, reason, confidence?)`
- `graph.retract_assertion(assertion_id, reason)`
- `notes.update(node_id, markdown, expected_content_version, reason)`

Memory creation is intentionally not a general chat tool. After each successful turn, a separate strict structured-output pass may call the server-only Memory proposal RPC. The user then edits and approves or rejects the complete Memory-and-connections bundle.

Do not add a generic “execute operation” tool or SQL tool. Specialized domain tools can appear only when a real module requires constraints that the generic graph operation cannot express.

## Answer flow

```text
user question
  -> classify as read-only or potentially mutating
  -> search for likely anchor nodes
  -> resolve ambiguity or ask for clarification
  -> traverse a bounded neighborhood
  -> rank useful paths outside the model
  -> retrieve detailed content for selected nodes
  -> compose an answer with node/edge evidence
  -> return traversal trace for UI inspection
```

The orchestrator should prefer explicit relationships over semantic similarity, short paths over long ones, and user/deterministic provenance over low-confidence inference. Those are ranking signals, not absolute truth rules.

Historical conversation retrieval is layered: a graph relationship makes a conversation a candidate; its durable summary determines whether it remains relevant; ranked message search selects a few excerpts; and a final bounded context call loads only the nearby messages needed to interpret the best excerpt. The whole conversation is never injected by default.

## Context sent to the model

Send:

- The current user request and a small amount of relevant conversation state.
- Candidate node IDs, types, titles, summaries, and relevance signals.
- Bounded edge facts including type, direction, provenance, and explanation.
- Full content only for the nodes selected after traversal.
- Tool definitions, limits, and mutation policy.
- Node `created_at` and `updated_at` values as modest retrieval signals.

Do not send:

- The complete graph or all notes.
- Raw embedding vectors.
- Database internals, service credentials, RLS policy details, or arbitrary SQL results.
- Entire chat history when a durable summary is sufficient.
- Hidden chains of thought. A short evidence trail and operation rationale are enough.

## Mutation flow

1. The model chooses a typed mutation tool.
2. The server validates its arguments against the same runtime schema exposed to the model.
3. The server resolves authorization, type compatibility, owner-wide node-title numbering, exact semantic duplicates, and optimistic versions.
4. The operation is returned as a preview when confirmation is required.
5. The user confirms, edits, or rejects the change.
6. The database writes the graph mutation and audit entry in one transaction.
7. The UI presents the applied delta.

Example result:

```text
Created
  BGP (note)

Connected
  BGP --related_to--> Homelab
  provenance: ai
  reason: The user explicitly requested this connection.
```

## Approval policy for V1

| Operation | Default behavior |
| --- | --- |
| Search, inspect, traverse | Execute immediately |
| Create a node explicitly requested by the user | Auto-apply, record in ledger, and offer undo |
| Propose an exact semantic relationship | Require approval; reuse canonical support and supersede equivalent pending proposals |
| Update substantive user content | Require confirmation and show diff |
| Retract an assertion or archive/remove content | Require confirmation |
| Bulk changes | Out of scope |
| Extract a durable personal Memory | Create an editable proposal after the answer; require approval before any graph mutation |

Before the main model call, retrieve at most eight ranked active, unexpired approved Memories. Send all results inside that hard bound to the model as compact typed, untrusted evidence and let the model judge contextual relevance; retrieval ranking must not semantically gate the model's reasoning context. The extractor receives at most six recent messages, may cite only supplied user-message IDs, emits at most three candidates, and cannot save credentials, assistant-authored claims, temporary remarks, or inferred personality traits.

Ordinary graph search returns every ranked candidate inside the requested hard bound so retrieval does not semantically gate model reasoning. Search output is candidate metadata, not answer evidence, and the model must select a candidate by loading, traversing, or changing it before relying on or citing it. The user-facing Sources panel may omit weak semantic-only search neighbors; that presentation filter never changes what the model received.

Before the main model call, exact or conservatively typo-matched whole-title and alias references to existing Notes in the latest user message resolve to at most four identity-only anchors containing stable IDs, canonical titles, match reasons, and match scores. An anchor is not content or answer evidence; it gives the model a candidate target for the ordinary graph/content tools while preserving enough match evidence to reject a weak fuzzy candidate. On the first anchored reasoning round, tool choice is required from the unchanged complete registry; the model still chooses the relevant candidate and appropriate tool. Later rounds return to automatic tool choice. The Note enters used evidence and Sources only if the model actually loads, traverses, or changes it. A future structured `@node` mention should resolve to a stable node ID and enter this same reference stage rather than creating a second context mechanism.

Before Memory extraction, resolve exact whole-title and alias mentions from the latest user message independently of the main answer's retrieval path. A conservative trigram fallback also accepts likely misspellings for labels of at least five characters; exact matches always rank first, short labels are never fuzzily guessed, and all resulting connections remain inside the approval proposal. Explicitly mentioned non-Memory nodes are the highest-priority connection candidates. If the proposed Memory remains explicitly scoped to one of them, the proposal includes an `about` connection even when the main answer did not retrieve that node. Only the current user message may support a new candidate, except that a short confirmation may also cite the preceding user statement. Graph-mutation commands and recap requests do not trigger extraction unless they contain an explicit remember request. Candidate statements receive a final lexical-grounding check against their cited user messages. Compatible preference dimensions use separate semantic keys; only contradictory values for the same scope and behavior dimension update one another. Automatic Memory-to-Memory suggestions are excluded from extraction: retrieving two similar Memories does not make their similarity a permanent graph fact. The ordinary relationship proposal flow remains available when the user explicitly requests a meaningful relationship between Memories.

A turn that creates or updates note content does not also extract that authored content into Memory. This prevents the same information from being organized as both a Note and a Memory merely because the note text uses first-person language. Extraction still runs when the same turn contains an explicit `remember` or `save as a memory` request.

Note creation stores Markdown and reconciles its initial wiki-links in one database transaction. A resolved `[[Title]]` therefore creates or refreshes its Markdown `references` assertion immediately; it is deterministic provenance and never requires a separate AI relationship proposal. Note updates use the same reconciliation path. AI-authored note content uses wiki-link syntax when the user intentionally refers to a known existing node, but the system never silently rewrites arbitrary prose mentions. A missing or ambiguous wiki-link remains inspectable rather than silently creating an empty entity. Reconciliation reports how many Markdown assertions were retracted and whether independently supported edges remained active.

The audit record is required regardless of approval mode. Equivalent relationship requests across conversations share a canonical semantic key. Each request remains visible in history, while approval produces at most one edge and one active AI assertion. Undo affects only the assertion created by the approved proposal; reused support cannot be retracted by that proposal.

An authoritative AI create-node event deterministically adds `produced` from its conversation to the new entity. Existing Notes receive deterministic `discusses` context from an explicit user Note-title mention, an approved relationship involving that Note, or an authoritative AI Note update. These paths reconcile idempotently to one conversation/Note assertion. Retrieval candidates, selected UI context, unapproved relationship proposals, and Memory revisions remain inspectable in their normalized evidence/audit systems and do not create conversation edges.

## Ambiguity rules

- Never resolve multiple title/alias matches by guessing invisibly.
- On every node creation or rename, atomically assign an owner-wide title. A collision becomes `Title (2)`, then `Title (3)`, across all node types and creation paths.
- Return the final database-assigned title to the user when a suffix was added.
- Use stable IDs after resolution; do not make later calls by title alone.
- If the relationship type is unclear, select from the registered vocabulary and explain the best candidate, or ask the user.
- Do not create a `related_to` edge merely because two texts are semantically similar.
- Prefer a precise relationship over `related_to`. Adding precise support retracts only redundant automated broad support; it never silently removes a user's broad assertion.
- Do not convert a temporary retrieval path into durable knowledge without an explicit mutation.

## Reliability controls

- Bound model rounds and total tool calls separately. Run independent reads in parallel and cache identical reads within a request.
- Give every ordinary reasoning round the complete static typed tool registry with automatic model choice. Never semantically add or remove capabilities based on prompt wording, embeddings, retrieval, or classifiers.
- Validate every model tool call against the same schema exposed to the model before dispatching it.
- Reserve a final model round for grounded synthesis instead of returning a misleading traversal-limit failure.
- Use idempotency keys for retried mutations.
- Use optimistic content versions for updates.
- Return structured errors the model can recover from: `not_found`, `ambiguous`, `conflict`, `invalid_relationship`, `forbidden`, and `limit_exceeded`.
- Log tool names, durations, row counts, and outcomes without logging secrets.
- Treat all node and imported content as untrusted data that cannot override system/tool policy.
- Summarize incrementally with a monotonic message-sequence cursor, a strict structured-output schema, source hashes, summary versions, and message-ID attribution for decisions, facts, and open loops.
- Version the summary policy independently from the model. A policy change rebuilds the derived summary from bounded message batches so old classifications do not remain permanently current.
- Mark summaries stale whenever new messages arrive, refresh them after completed turns, and lazily backfill older selected conversations.
- Serialize summary commits per conversation. A stale generator cannot overwrite a newer cursor, and a message arriving during generation leaves the committed summary marked stale for the next bounded pass.
- Decide freshness by comparing the latest message sequence with `through_message_sequence`. A conversation node's general `updated_at` still advances whenever a message is added, but node recency alone never triggers a summary-model request.
- Treat summary retrieval keywords as private ranking metadata. They are not tags, graph nodes, or authority to mutate the graph.

## Evidence contract

Every graph-supported answer should return machine-readable evidence:

- searched node/message candidates, including bounded ranking evidence
- nodes actually used
- node IDs cited inline in the final answer
- traversed edge IDs and ordered paths
- detailed content spans used, when applicable
- unresolved ambiguity or confidence limitations

Inline node citations use `[Canonical title](workspace-node:NODE_UUID)`. The server resolves the canonical title, accepts only IDs from used evidence, removes invalid workspace destinations, and permits at most one pill per node. A node is cited only when the prose naturally names it or it directly supports a substantive claim; other used evidence remains available in Sources without being forced into the response. When a necessary citation has no natural inline reference, the model may place a single pill at the end. The Sources inspector keeps unused search candidates distinct from actual sources, so retrieval breadth remains visible without claiming every candidate grounded the answer.
