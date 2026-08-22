import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ActivityItem } from "@/types/graph";
import { ActivityCard } from "./activity-card";

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;

function relationship(overrides: Partial<Extract<ActivityItem, { kind: "relationship_proposal" }>> = {}): ActivityItem {
  return {
    kind: "relationship_proposal", id: id(1), status: "pending", state: "pending",
    available_actions: ["approve", "reject"], source_node_id: id(2), source_title: "BGP",
    target_node_id: id(3), target_title: "Homelab", relationship_type: "related_to",
    reason: "Requested by the user", confidence: 0.9, ai_run_id: id(4), conversation_id: id(5),
    edge_id: null, assertion_id: null, superseded_by_proposal_id: null,
    edge_was_created: null, assertion_was_created: null, created_at: "2026-08-20T00:00:00Z",
    resolved_at: null, undone_at: null, ...overrides,
  };
}

describe("ActivityCard", () => {
  it("exposes only backend-authorized pending actions", () => {
    const onAction = vi.fn();
    const item = relationship();
    render(<ActivityCard item={item} onAction={onAction} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onAction).toHaveBeenCalledWith(item, "approve");
  });

  it("shows Undo without resolution actions when that is the only authorized action", () => {
    render(<ActivityCard item={relationship({ status: "approved", state: "applied", available_actions: ["undo"] })} onAction={() => undefined} />);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("renders resolved history as read-only when no action is available", () => {
    render(<ActivityCard item={relationship({ status: "rejected", state: "rejected", available_actions: [] })} onAction={() => undefined} />);
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
