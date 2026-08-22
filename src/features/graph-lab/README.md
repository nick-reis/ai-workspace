# Graph

The graph renderer is the only frontend feature retained from the previous
application UI. It is presented as the `Graph` sidebar destination in the new
application layout.

## Data boundary

`GraphEngine` accepts only the plain `GraphData` contract exported from
`types.ts`. `src/features/graph/graph-lab-route.tsx` is the sole backend-aware
adapter: it fetches the current workspace graph and maps Supabase rows to
`GraphData`. Renderer and physics code do not know where that data originated.

## Runtime architecture

- `physics.worker.ts`: Barnes-Hut force simulation in a dedicated worker.
- `renderer.ts`: batched WebGL 2 renderer with a Canvas 2D fallback.
- `graph-engine.tsx`: camera, picking, dragging, labels, resizing, and worker
  buffer recycling.
- `graph-lab-page.tsx`: embedded presentation and data states.

The renderer route is lazy-loaded at `#/graph`, so its rendering code remains in
a separate bundle until the sidebar destination is opened.

## Removing the feature

1. Remove the `/graph` route and lazy import from `src/App.tsx`.
2. Delete `src/features/graph/graph-lab-route.tsx`.
3. Remove the `Graph` item from `src/app/navigation.ts`.
4. Delete this directory.

The read-only graph API adapter and its query key can then be removed if the new
frontend does not reuse them.
