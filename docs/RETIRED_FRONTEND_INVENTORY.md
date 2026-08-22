# Retired frontend inventory

This records the product UI removed on 2026-08-17 before the frontend rebuild.
It is an inventory, not a specification for the replacement.

## Application shell and access

- GitHub OAuth login screen, loading state, auth error state, sign-out control,
  browser callback handling, and Tauri deep-link callback handling.
- Authenticated route wrapper around the former workspace.
- Shared shadcn-style primitives: badge, button, card, input, and textarea.
- Global light/dark design tokens, semantic color variables, shared radii, and
  node-type utility colors.

## Workspace layout

- Three-column desktop layout: entity browser, graph canvas, and inspector.
- Header with product identity, graph-mode status, Graph Lab link, workspace
  reset, and sign out.
- Focused-graph and all-graph modes with node-type and relationship filters.
- Zustand selection, graph-mode, filter, and inspector-tab state.

## Entity browsing and editing

- Searchable entity list with note, conversation, and memory type filters.
- Note creation flow.
- Entity inspector for title, summary, created/modified metadata, and permanent
  deletion.
- Markdown note editor with `[[Wiki Links]]` and unresolved-link warnings.
- Conversation summaries with decisions, open loops, message counts, and
  summary versions.
- Approved-memory details with confidence, semantic key, expiry, revision
  history, and source-message excerpts.

## Graph interactions

- Cytoscape workspace graph with selection, pan/zoom, fit, and layout refresh.
- Focused neighborhoods and complete workspace graph views.
- Node and edge inspection, incoming backlinks, outgoing connections, manual
  relationship creation, assertion provenance, and assertion retraction.

## AI and review workflows

- Streaming “Ask the graph” chat UI with tool progress and conversation state.
- Memory and relationship proposal review.
- Activity ledger for graph changes, approvals/rejections, and undo actions.
- Destructive confirmation dialogs for entity deletion and workspace reset.

## Retained during the rebuild

- The retained graph renderer, now available as the `Graph` sidebar destination
  at `#/graph` and still isolated in a lazy-loaded bundle.
- Its worker-based physics, WebGL/Canvas renderer, camera and node interactions,
  labels, read-only Supabase graph adapter, query key, and graph data types.
- Backend code, database migrations, Supabase functions, generated database
  types, and product/architecture documentation.

## Rebuild foundation added afterward

- The supplied dark shadcn theme tokens and dark-by-default document setup.
- A new isolated shadcn sidebar shell with animated icon collapse, Ctrl+B
  shortcut, double-click rail toggle, GSAP-assisted drag resizing, collapse
  snapping, mobile sheet behavior, tooltips, and persisted width/open state.
- A route-aware app layout and Supabase auth context that show the current
  GitHub user's initial, display name, and email in the sidebar account block.
- A new `Chat` sidebar destination, adapted from the `my-workspace` chat UI:
  animated/resizable conversation directory, message stream, composer controls,
  evidence summaries, and inline Memory/relationship/graph-change review.
  It talks directly to this project's `graph-chat` SSE function and graph RPCs;
  none of the retired frontend service layer was restored.
