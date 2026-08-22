import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnimatedFilterLabel } from "./workspace-search-filter";
import { workspaceSearchFilters } from "./workspace-search-filters";

const gsapMocks = vi.hoisted(() => {
  const timeline = { fromTo: vi.fn(), kill: vi.fn() };
  timeline.fromTo.mockReturnValue(timeline);
  return { timeline, createTimeline: vi.fn(() => timeline) };
});

vi.mock("gsap", () => ({
  gsap: { timeline: gsapMocks.createTimeline },
}));

describe("WorkspaceSearchFilterMenu", () => {
  beforeEach(() => {
    gsapMocks.timeline.fromTo.mockClear();
    gsapMocks.timeline.kill.mockClear();
    gsapMocks.createTimeline.mockClear();
    window.matchMedia = vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    });
  });

  it("shows every canonical node-type choice", () => {
    expect(workspaceSearchFilters.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: "all", label: "All nodes" },
      { value: "conversation", label: "Conversations" },
      { value: "memory", label: "Memories" },
      { value: "note", label: "Notes" },
    ]);
  });

  it("moves the old label down and the new label in from above", async () => {
    const view = render(<AnimatedFilterLabel value="all" />);
    view.rerender(<AnimatedFilterLabel value="note" />);

    await waitFor(() => expect(gsapMocks.timeline.fromTo).toHaveBeenCalledTimes(2));
    expect(gsapMocks.timeline.fromTo.mock.calls.some((call) => call[1]?.y === -8 && call[2]?.y === 0)).toBe(true);
    expect(gsapMocks.timeline.fromTo.mock.calls.some((call) => call[1]?.y === 0 && call[2]?.y === 8)).toBe(true);
  });

  it("swaps labels without a timeline for reduced motion", () => {
    window.matchMedia = vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    });
    const view = render(<AnimatedFilterLabel value="all" />);
    view.rerender(<AnimatedFilterLabel value="conversation" />);

    expect(screen.getByText("Conversations")).toBeVisible();
    expect(gsapMocks.createTimeline).not.toHaveBeenCalled();
  });
});
