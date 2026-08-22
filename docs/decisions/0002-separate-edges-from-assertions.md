# ADR 0002: Separate semantic edges from supporting assertions

- Status: Accepted for V1
- Date: 2026-08-13

## Context

A relationship can be supported by several independent sources. A user may connect BGP to Homelab, a note may contain `[[Homelab]]`, and the AI may later explain the same relationship. Storing provenance directly on `edges` would either duplicate the visual relationship or make one source overwrite another.

## Decision

`edges` stores only the canonical semantic fact: owner, endpoints, and relationship type. `edge_assertions` stores each independent support with provenance, source locator, reason, confidence, AI run, and lifecycle status.

An edge is live while at least one active assertion supports it. Removing a wiki-link retracts only its Markdown assertion. Undoing an AI action retracts only the assertion created by that action. The semantic edge is archived only after its final active assertion is retracted.

## Consequences

- The graph renders one relationship regardless of how many sources support it.
- The edge inspector can explain every source independently.
- Undo and reconciliation cannot accidentally delete independently supported knowledge.
- Queries that need provenance join assertions, while basic traversal stays compact.

## Guardrails

- Similarity scores are retrieval signals and never assertions by themselves.
- Deterministic sources use stable `origin_key` values for idempotent reconciliation.
- Assertions are recoverably retracted, not hard-deleted.
- AI assertions record their run and a human-readable reason.

