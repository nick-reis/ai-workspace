# V1 roadmap

## Objective

Prove that a user and AI can share an inspectable, typed graph as a reliable context-selection and mutation system. Stop after the proof; do not rebuild the broader personal AI OS in this milestone.

## Phase 0 — foundation

- [x] Create the Tauri 2 + React + TypeScript scaffold.
- [x] Record product boundaries and architecture decisions.
- [x] Install the frontend, graph, validation, and test dependencies.
- [x] Establish a zero-warning TypeScript/React lint gate and repository engineering standards.
- [x] Connect the hosted Supabase project and create local environment configuration.
- [x] Configure GitHub authentication and the Tauri deep-link/single-instance callback.

Exit: a clean build and a documented system that can be explained before implementation.

## Phase 1 — graph data core

- [x] Create migrations for nodes, typed extensions, semantic edges, edge assertions, unresolved links, conversations/messages, and the activity ledger.
- [x] Add RLS policies and ownership tests.
- [x] Seed the small V1 node and relationship vocabularies.
- [x] Implement typed create/read/update/archive operations.
- [x] Implement bounded neighborhood and traversal RPCs.
- [x] Create audit records for graph mutations.

Exit: authenticated users can manipulate and traverse an isolated graph through typed operations, and invalid relationships fail deterministically.

## Phase 2 — visible graph workspace

- [x] Build the application shell with node browser, graph canvas, and inspector/chat area.
- Render node types, edge directions, labels, and assertion provenance in Cytoscape.
- Add selection, pan/zoom, focused-neighborhood expansion, filters, and empty/loading/error states.
- Build node and edge inspector panels.
- Add manual node and relationship creation.
- Add note Markdown editing and wiki-link reconciliation.

Exit: a user can create BGP and Homelab, link them, inspect the edge, and see correct backlinks without using AI.

## Phase 3 — read-only AI traversal

- [x] Add the Supabase Edge Function orchestrator and server-held OpenAI secret.
- [x] Implement read tools and bounded tool loops.
- [x] Display searched anchors, traversal paths, and evidence.
- [x] Separate searched candidates from used/cited evidence and render validated inline node citations.
- Add ambiguity handling and useful failure states.
- Evaluate a fixed set of graph questions.

Exit: the AI answers graph questions using observable paths and does not need a workspace-wide content dump.

## Phase 4 — AI graph mutation

- [x] Implement create/update tools with schema validation.
- [x] Add previews, confirmation, rejection, retry-safe idempotency, and exact relationship proposal reconciliation.
- [x] Display the resulting graph delta and permanent audit entry.
- [x] Prevent stale cross-conversation approvals and duplicate active AI support.

Exit: the AI can create and connect notes, the user can review the exact change, and the graph updates immediately.

## Phase 5 — semantic retrieval experiment

- [x] Add pgvector chunk storage and model/version metadata.
- [x] Use combined lexical, note-body, and vector evidence only to rank candidate nodes.
- Compare graph-only, vector-only, and combined retrieval on the same evaluation questions.
- Keep semantic edge suggestions separate from permanent relationships.

Exit: measurements show whether embeddings improve anchor discovery without weakening inspectability.

## V1 acceptance scenarios

### Manual graph

- Create two different node types and a typed directed edge.
- Inspect outgoing and incoming presentations of the relationship.
- Archive the edge and recover the expected graph state.

### Markdown

- `[[Homelab]]` resolves to exactly one node and creates a Markdown assertion for one semantic edge.
- Removing the mention retracts only that assertion and preserves other support.
- Ambiguous and missing targets remain visible and do not silently mislink.

### AI read

- “What is connected to my Homelab?” returns bounded results and visible evidence.
- “Why is BGP connected to it?” identifies the exact edge, direction, provenance, and explanation.
- A similarly named node triggers ambiguity handling.

### AI write

- “Create a note about BGP and connect it to my Homelab” produces a correct preview and atomic applied change.
- A duplicate request is idempotent or clearly identified as an existing relationship.
- Two equivalent pending requests in different conversations reconcile on approval: one approved, one superseded, and exactly one active AI assertion.
- Rejected changes do not mutate the graph.

### Security and limits

- One user cannot read or connect another user's nodes.
- Traversal refuses excessive depth/row limits.
- No OpenAI or service-role secret is present in the frontend bundle.

## Evaluation metrics

- Anchor resolution accuracy on a curated question set.
- Correct relationship path and direction.
- Unsupported-claim rate in answers.
- Percentage of answers whose evidence is understandable to the user.
- Median nodes, edges, and content tokens loaded per question.
- Mutation success, rejection, duplicate, and rollback behavior.

## Stop conditions

Do not add the first full module until the acceptance scenarios pass and the user can explain the data model, traversal path, and mutation review flow. The next module should then be chosen because it tests the graph architecture, not because the roadmap needs more surface area.
