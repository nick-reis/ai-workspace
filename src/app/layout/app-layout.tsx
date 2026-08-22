import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import HistoryIcon from "@hugeicons/core-free-icons/HistoryIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { AppSidebar } from "@/app/layout/app-sidebar";
import { navigation } from "@/app/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { activityKeys, getPendingActivityCount } from "@/features/activity/activity-api";
import { WorkspaceSearchDialog } from "@/features/search/workspace-search-dialog";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const pendingActivity = useQuery({ queryKey: activityKeys.pendingCount, queryFn: getPendingActivityCount });
  const currentPage =
    navigation.find((item) => item.path === location.pathname) ?? navigation[0];

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      setSearchOpen((open) => !open);
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);

  return (
    <SidebarProvider
      defaultOpen
      className="h-svh min-h-0 overflow-hidden"
      style={{ "--window-titlebar-height": "0px" } as CSSProperties}
    >
      <AppSidebar />
      <SidebarInset className="h-full min-h-0 min-w-0 overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl md:h-[72px] md:px-6">
          <SidebarTrigger className="-ml-1" />
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="hidden text-muted-foreground sm:inline">AI Workspace</span>
            <span className="hidden text-border sm:inline">/</span>
            <span className="truncate font-medium text-foreground">{currentPage.title}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger render={<Button aria-label="Open history" variant="ghost" size="icon" className="relative" onClick={() => navigate("/history")} />}>
                <Icon icon={HistoryIcon} />
                {pendingActivity.data ? <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-4 text-primary-foreground">{pendingActivity.data > 99 ? "99+" : pendingActivity.data}</span> : null}
              </TooltipTrigger>
              <TooltipContent>History</TooltipContent>
            </Tooltip>
            <Button variant="outline" className="hidden min-w-44 justify-between text-muted-foreground lg:flex" onClick={() => setSearchOpen(true)}> 
              <span className="flex items-center gap-2"><Icon icon={Search01Icon} />Search workspace</span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Ctrl K</kbd>
            </Button>
            <Button aria-label="Search workspace" title="Search workspace" variant="ghost" size="icon" className="lg:hidden" onClick={() => setSearchOpen(true)}><Icon icon={Search01Icon} /></Button>
            <Button className="hidden sm:inline-flex" onClick={() => navigate("/chat", { state: { newChatRequest: crypto.randomUUID() } })}><Icon icon={Add01Icon} data-icon="inline-start" />New chat</Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </SidebarInset>
      {searchOpen ? <WorkspaceSearchDialog open onOpenChange={setSearchOpen} /> : null}
    </SidebarProvider>
  );
}
