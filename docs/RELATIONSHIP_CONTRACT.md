# Relationship semantic contract

Graph relationships are durable semantic claims. They are not interaction logs, retrieval traces, audit events, or a substitute for source provenance. The database relationship registry is authoritative; this document defines the product meaning that prompts, UI labels, migrations, and tests must preserve.

## Vocabulary

| Type | Exact source → target meaning | May be automatic | Must not mean |
| --- | --- | --- | --- |
| `related_to` | A is meaningfully associated with B and no precise registered type fits. Symmetric. | No; review required | Embedding similarity, co-retrieval, or an easy fallback |
| `references` | A explicitly cites, links, or points to B. | Only deterministic wiki-link reconciliation | General subject matter, evidence, or derivation |
| `about` | B is a substantial subject of A. | No; review required | Passing mention, citation, creation, or mutation history |
| `part_of` | A is a constituent contained by B. | No; review required | Loose grouping, ordering, dependency, or similarity |
| `supports` | A contributes evidence, material, or progress toward B. | No; review required | Why an edge is believed; that is an assertion |
| `derived_from` | A was transformed, computed, or summarized from B. | No; review required | Citation, conversational creation, or revision history |
| `discusses` | Conversation A substantially discusses existing Note B as subject matter. | Explicit user Note-title mention, approved relationship involving the Note, or AI-authored Note update | Retrieval candidate, selected UI context, Memory revision, unapproved relationship proposal, or incidental load |
| `produced` | Conversation A directly caused new durable entity B to be created. | Yes, from an authoritative AI `create_node` audit event | Updates, discussion, retrieval, or pre-existing entities |

## Boundary rules

- `edges` answer “what is the semantic relationship?”
- `edge_assertions` answer “why does the system believe that relationship exists?”
- `graph_changes`, proposals, and AI runs answer “what operation occurred, when, and through which workflow?”
- `memory_revision_sources` answer “which messages and conversation support this exact Memory revision?”
- answer evidence answers “what did this response retrieve and use?”

Do not promote an event from one of those provenance/audit systems into a semantic edge merely to make the event visible in the graph.

## Conversation rules

Creating a new Note or Memory through an AI run may deterministically create `conversation --produced--> entity`, because the creation event proves that exact origin. Existing Notes receive `conversation --discusses--> Note` from direct, inspectable context: an explicit user title mention, an approved relationship involving that Note, or an AI-authored Note update. These paths reconcile to one system assertion per conversation/Note. Updating a Memory creates revision source rows and does not create a conversation edge. Retrieval candidates, selected UI context, and unapproved relationship proposals do not create graph relationships.

Other `discusses` claims remain explicit and reviewed. Ordinary retrieval and semantic similarity never create graph relationships.

## Adding or changing a relationship

Any vocabulary change must update together:

1. the SQL relationship registry and endpoint constraints;
2. the frontend domain registry and runtime schema;
3. the AI proposal tool enum and description, if AI may propose it;
4. graph presentation labels/colors;
5. this contract and database/unit tests;
6. a migration policy for existing assertions that preserves user-authored provenance.

Similarity may identify candidate anchors. It never proves a relationship.
