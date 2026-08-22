import type { User } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarMenu, SidebarProvider } from "@/components/ui/sidebar";

import { SidebarAccountMenu } from "./sidebar-account-menu";

vi.mock("./account-api", () => ({
  deleteWorkspaceData: vi.fn().mockResolvedValue({}),
  signOutCurrentDevice: vi.fn().mockResolvedValue(undefined),
}));

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "nick@example.com",
  user_metadata: { full_name: "Nick" },
} as User;

function renderAccountMenu() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SidebarProvider>
          <SidebarMenu>
            <SidebarAccountMenu user={user} />
          </SidebarMenu>
        </SidebarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SidebarAccountMenu", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    });
  });

  it("shows account actions from the top-level user trigger", async () => {
    const interaction = userEvent.setup();
    renderAccountMenu();

    await interaction.click(screen.getByRole("button", { name: /Nick/ }));

    expect(screen.getByText("Sign out")).toBeVisible();
    expect(screen.getByText("Delete my data")).toBeVisible();
  });

  it("requires the exact confirmation before data deletion is enabled", async () => {
    const interaction = userEvent.setup();
    renderAccountMenu();

    await interaction.click(screen.getByRole("button", { name: /Nick/ }));
    await interaction.click(screen.getByText("Delete my data"));

    const deleteButton = screen.getByRole("button", { name: "Delete my data" });
    expect(deleteButton).toBeDisabled();

    await interaction.type(screen.getByLabelText(/Type RESET to confirm/), "RESET");
    expect(deleteButton).toBeEnabled();
  });
});
