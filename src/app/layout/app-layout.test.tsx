import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppLayout } from "./app-layout";

vi.mock("./app-sidebar", () => ({ AppSidebar: () => <aside>Sidebar</aside> }));
vi.mock("@/features/activity/activity-api", () => ({
  activityKeys: { pendingCount: ["activity", "pending-count"] },
  getPendingActivityCount: vi.fn().mockResolvedValue(0),
}));

function renderLayout() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<main>Home</main>} />
            <Route path="search" element={<main>Old search page</main>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AppLayout workspace search", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    });
  });

  it("toggles the workspace search dialog with Control+K", async () => {
    const interaction = userEvent.setup();
    renderLayout();

    await interaction.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("dialog", { name: "Search workspace" })).toBeVisible();

    await interaction.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog", { name: "Search workspace" })).not.toBeInTheDocument();
  });

  it("starts each search session with the All filter", async () => {
    const interaction = userEvent.setup();
    renderLayout();

    await interaction.keyboard("{Control>}k{/Control}");
    const input = screen.getByRole("searchbox", { name: "Search workspace" });
    await interaction.click(input);
    await interaction.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: /filter nodes: conversations/i })).toBeVisible();

    await interaction.keyboard("{Control>}k{/Control}");
    await interaction.keyboard("{Control>}k{/Control}");

    expect(screen.getByRole("button", { name: /filter nodes: all nodes/i })).toBeVisible();
  });
});
