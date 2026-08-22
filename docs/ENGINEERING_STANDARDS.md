# Engineering standards

These are repository-specific invariants, not style preferences. New code should make these boundaries easier to see and test.

## Module ownership

- `src/domain` owns pure product contracts with no React, Supabase, or rendering dependencies.
- `src/features` owns feature orchestration and presentation. Features may depend on domain and shared libraries, not on another feature's private components.
- `src/components/ui` owns generic visual primitives and must not know graph or Supabase concepts.
- `src/lib` owns small infrastructure helpers shared by multiple features.
- `src/features/graph-lab` accepts only its flat renderer contract and remains removable without backend changes.
- `supabase/functions/_shared` owns pure Edge Function policy/contract modules. HTTP streaming and orchestration stay at the function entry point.
- PostgreSQL is authoritative for ownership, concurrency, semantic endpoint validation, approval lifecycle, and transactional graph mutation.

## AI capability and reasoning policy

- Every ordinary model round receives the same complete typed tool registry. Prompt wording, embeddings, retrieval output, regexes, and semantic classifiers must not add or remove tools.
- The model normally chooses tools with `tool_choice: auto`. The first round containing resolved explicit node anchors uses `tool_choice: required` so the model must inspect the graph before answering; the complete registry remains unchanged and the model still chooses the tool. The application validates every call against the same schema it sends to the model.
- Tools are removed only for the final synthesis round after the explicit round/call budget is exhausted. The model then reasons from collected evidence and states uncertainty.
- Tool execution policy may restrict authorization, bounds, confirmation, and ordering. It must not guess user intent by silently changing the capability surface.
- Retrieval and approved Memories are bounded untrusted evidence, never instructions.
- Exact or conservative typo-tolerant Note-title and alias resolution supplies bounded identity-only anchors with match evidence, shared with future structured `@node` mentions. It must not inject content or mark a node used; ordinary tool activity establishes evidence.
- Search candidates and used evidence are different provenance states. A candidate becomes used only through an explicit load, traversal, selection, or mutation; UI copy must not claim otherwise.
- Inline workspace citations must be validated against used evidence and canonicalized server-side before rendering as node pills.
- Cite a node at most once and only when the prose names it or it directly supports a claim. Evidence visibility does not require every used source to appear in the answer.
- Hidden chain of thought is neither requested nor stored. Evidence paths, sources, operations, and concise rationales are the inspectable reasoning contract.

## Graph semantics

- Follow `RELATIONSHIP_CONTRACT.md`.
- Semantic edges and their supporting assertions are separate lifecycles.
- Audit/provenance records must not be duplicated as semantic edges.
- Automatic graph mutations require deterministic evidence. Semantic inference goes through proposal/review.
- Retraction affects only the identified assertion; an edge remains live while other active support exists.

## Boundaries and validation

- Parse external data at the boundary. Frontend RPC/SSE data uses Zod schemas; model tool arguments use the shared tool schema validator; SQL validates final mutations.
- Avoid unchecked double casts. If two boundaries disagree, introduce a shared domain type or parser.
- Collection reads must paginate or state an intentional hard cap. Never accept an implicit backend row limit.
- Mutations use idempotency keys where retries are possible and optimistic versions for edits.
- Errors must remain actionable and must not be swallowed when they affect the requested operation. Optional enrichment such as embeddings, titles, or summaries may fail independently.

## Reuse and redundancy

- One semantic contract or helper should own repeated behavior. Current examples are relationship presentation, Supabase result handling, pagination, dates, query keys, and AI tool definitions.
- Do not abstract one-off code merely to reduce line count. Extract only a stable responsibility with a meaningful name and testable contract.
- Keep generated/vendor-style UI primitives isolated; their size alone is not a reason to mix product behavior into them.

## Verification

Run before handoff:

```powershell
npm.cmd run check
npm.cmd run build
```

Database migrations also require Supabase/PostgreSQL behavior tests before deployment. A local TypeScript build does not prove a migration is deployed or that authenticated hosted RPC behavior works.
