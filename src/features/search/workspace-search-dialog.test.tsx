import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSearchDialog } from "./workspace-search-dialog";

const searchNodes = vi.hoisted(() => vi.fn());
const staggerMounts = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: searchNodes },
}));

vi.mock("@/components/ui/stagger-children", async () => {
  const { useEffect } = await vi.importActual<typeof import("react")>("react");
  return {
    StaggerChildren: ({ children }: { children: ReactNode }) => {
      useEffect(() => { staggerMounts(); }, []);
      return <div>{children}</div>;
    },
  };
});

const node = (
  id: string,
  type: "conversation" | "memory" | "note",
  title: string,
) => ({
  id,
  owner_id: "00000000-0000-4000-8000-000000000099",
  type,
  title,
  summary: `${title} summary`,
  version: 1,
  created_at: "2026-08-20T12:00:00Z",
  updated_at: "2026-08-21T12:00:00Z",
  archived_at: null,
});

const fixtures = [
  node("00000000-0000-4000-8000-000000000001", "conversation", "Project kickoff"),
  node("00000000-0000-4000-8000-000000000002", "note", "Roadmap notes"),
  node("00000000-0000-4000-8000-000000000003", "conversation", "Roadmap decisions"),
  node("00000000-0000-4000-8000-000000000004", "memory", "Research preferences"),
];

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}{location.search}</output>;
}

function renderSearchDialog(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkspaceSearchDialog open onOpenChange={onOpenChange} />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { onOpenChange };
}

describe("WorkspaceSearchDialog", () => {
  beforeEach(() => {
    searchNodes.mockReset();
    searchNodes.mockImplementation((_name, args: { p_query: string; p_types: string[] | null }) => {
      const query = args.p_query.toLowerCase();
      return Promise.resolve({
        data: fixtures.filter((item) =>
          (!args.p_types || args.p_types.includes(item.type))
          && (!query || item.title.toLowerCase().includes(query))),
        error: null,
      });
    });
    staggerMounts.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
    window.matchMedia = vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    });
  });

  it("shows every node filter in a dropdown and cycles them with Tab", async () => {
    const interaction = userEvent.setup();
    renderSearchDialog();

    const input = screen.getByRole("searchbox", { name: "Search workspace" });
    await interaction.click(screen.getByRole("button", { name: /filter nodes: all nodes/i }));
    expect(screen.getByRole("menuitemradio", { name: "Conversations" })).toBeVisible();
    expect(screen.getByRole("menuitemradio", { name: "Memories" })).toBeVisible();
    expect(screen.getByRole("menuitemradio", { name: "Notes" })).toBeVisible();
    await interaction.keyboard("{Escape}");

    await interaction.click(input);
    await interaction.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: /filter nodes: conversations/i })).toBeVisible();

    await interaction.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("button", { name: /filter nodes: all nodes/i })).toBeVisible();
    expect(input).toHaveFocus();
  });

  it("updates title results after the first typed character", async () => {
    const interaction = userEvent.setup();
    renderSearchDialog();
    const input = screen.getByRole("searchbox", { name: "Search workspace" });

    expect(await screen.findByRole("option", { name: /Project kickoff/ })).toBeVisible();
    await interaction.type(input, "d");

    await waitFor(() => expect(searchNodes).toHaveBeenLastCalledWith("search_nodes", {
      p_query: "d",
      p_types: null,
      p_limit: 50,
    }));
    expect(await screen.findByRole("option", { name: /Roadmap notes/ })).toBeVisible();
    expect(screen.queryByRole("option", { name: /Project kickoff/ })).not.toBeInTheDocument();
  });

  it("searches all nodes and opens the highlighted conversation with Enter", async () => {
    const interaction = userEvent.setup();
    const selectedConversationId = "00000000-0000-4000-8000-000000000003";
    const { onOpenChange } = renderSearchDialog();
    const input = screen.getByRole("searchbox", { name: "Search workspace" });

    await interaction.type(input, "roadmap");
    expect(await screen.findByRole("option", { name: /Roadmap notes/ })).toHaveAttribute("aria-selected", "true");

    await interaction.keyboard("{ArrowDown}{Enter}");

    expect(screen.getByLabelText("Current location")).toHaveTextContent(`/chat?conversation=${selectedConversationId}`);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("uses the selected node type when searching", async () => {
    const interaction = userEvent.setup();
    renderSearchDialog();
    const input = screen.getByRole("searchbox", { name: "Search workspace" });

    await interaction.click(input);
    await interaction.keyboard("{Tab}");

    await waitFor(() => expect(searchNodes).toHaveBeenLastCalledWith("search_nodes", {
      p_query: "",
      p_types: ["conversation"],
      p_limit: 50,
    }));
  });

  it("remounts the result animation for filters but not typed queries", async () => {
    const interaction = userEvent.setup();
    renderSearchDialog();
    const input = screen.getByRole("searchbox", { name: "Search workspace" });

    await screen.findByRole("option", { name: /Project kickoff/ });
    expect(staggerMounts).toHaveBeenCalledTimes(1);
    await interaction.type(input, "road");
    await screen.findByRole("option", { name: /Roadmap notes/ });
    expect(staggerMounts).toHaveBeenCalledTimes(1);

    await interaction.keyboard("{Tab}");
    await waitFor(() => expect(staggerMounts).toHaveBeenCalledTimes(2));
  });

  it("opens a conversation when its result is clicked", async () => {
    const interaction = userEvent.setup();
    const conversationId = "00000000-0000-4000-8000-000000000004";
    searchNodes.mockResolvedValue({
      data: [node(conversationId, "conversation", "Quarterly planning")],
      error: null,
    });
    const { onOpenChange } = renderSearchDialog();

    await interaction.click(await screen.findByRole("option", { name: /Quarterly planning/ }));

    expect(screen.getByLabelText("Current location")).toHaveTextContent(`/chat?conversation=${conversationId}`);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps notes and memories visible without navigating to them", async () => {
    const interaction = userEvent.setup();
    const noteId = "00000000-0000-4000-8000-000000000005";
    searchNodes.mockResolvedValue({
      data: [node(noteId, "note", "Unrouted research note")],
      error: null,
    });
    const { onOpenChange } = renderSearchDialog();
    const result = await screen.findByRole("option", { name: /Unrouted research note/ });

    expect(result).toBeDisabled();
    expect(result).toHaveAttribute("aria-disabled", "true");
    expect(result).toHaveTextContent("No page yet");
    await interaction.click(result);

    expect(screen.getByLabelText("Current location")).toHaveTextContent(/^\/$/);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
