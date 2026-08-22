import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { StaggerChildren } from "@/components/ui/stagger-children";
import { nodeTypeDefinitions } from "@/domain/graph/node-types";

import { searchWorkspaceNodes, type WorkspaceSearchNode } from "./workspace-search-api";
import { WorkspaceSearchFilterMenu } from "./workspace-search-filter";
import { workspaceSearchFilters, type WorkspaceSearchFilter } from "./workspace-search-filters";

const noResults: WorkspaceSearchNode[] = [];

export function WorkspaceSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorkspaceSearchFilter>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const search = useQuery({
    queryKey: ["workspace-search", query.trim(), filter],
    queryFn: () => searchWorkspaceNodes(query, filter === "all" ? null : filter),
    enabled: open,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === filter ? previousData : undefined,
  });
  const results = search.data ?? noResults;
  const effectiveActiveIndex = results.length ? Math.min(activeIndex, results.length - 1) : 0;

  useEffect(() => {
    const activeResult = results[effectiveActiveIndex];
    if (!activeResult) return;
    document.getElementById(`workspace-search-result-${activeResult.id}`)?.scrollIntoView({ block: "nearest" });
  }, [effectiveActiveIndex, results]);

  const openResult = (result: WorkspaceSearchNode | undefined) => {
    if (!result || result.type !== "conversation") return;
    navigate(`/chat?conversation=${encodeURIComponent(result.id)}`);
    onOpenChange(false);
  };

  const changeFilter = (nextFilter: WorkspaceSearchFilter) => {
    setFilter(nextFilter);
    setActiveIndex(0);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      const currentIndex = workspaceSearchFilters.findIndex((option) => option.value === filter);
      const nextIndex = (currentIndex + direction + workspaceSearchFilters.length) % workspaceSearchFilters.length;
      changeFilter(workspaceSearchFilters[nextIndex].value);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!results.length) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (Math.min(current, results.length - 1) + direction + results.length) % results.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      openResult(results[effectiveActiveIndex]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="sr-only">Search workspace</DialogTitle>
        <DialogDescription className="sr-only">
          Search notes, memories, and conversations.
        </DialogDescription>
        <div className="flex items-center gap-3 p-4">
          <Input
            className="min-w-0 flex-1"
            aria-label="Search workspace"
            autoFocus
            placeholder="Search node titles…"
            role="searchbox"
            type="search"
            value={query}
            aria-activedescendant={results[effectiveActiveIndex] ? `workspace-search-result-${results[effectiveActiveIndex].id}` : undefined}
            aria-controls="workspace-search-results"
            aria-expanded={results.length > 0}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
          />
          <WorkspaceSearchFilterMenu value={filter} onValueChange={changeFilter} />
        </div>
        <div className="border-t border-border">
          {search.isPending ? (
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
          ) : search.error ? (
            <p role="alert" className="p-6 text-center text-sm text-destructive">Workspace search is unavailable.</p>
          ) : !results.length ? (
            <p role="status" className="p-8 text-center text-sm text-muted-foreground">
              {query.trim() ? "No matching nodes found." : "No workspace nodes yet."}
            </p>
          ) : null}
          <div
            id="workspace-search-results"
            role="listbox"
            aria-label="Search results"
            aria-busy={search.isFetching}
            hidden={search.isPending || Boolean(search.error) || !results.length}
            className="scroll-fade max-h-80 overflow-y-auto p-2"
          >
            <StaggerChildren key={filter} ready={search.isSuccess}>
              {!search.error ? results.map((result, index) => {
                const presentation = nodeTypeDefinitions[result.type];
                const isActive = index === effectiveActiveIndex;
                const isAvailable = result.type === "conversation";
                return (
                  <Button
                    key={result.id}
                    id={`workspace-search-result-${result.id}`}
                    role="option"
                    aria-disabled={!isAvailable}
                    aria-selected={isActive}
                    data-active={isActive || undefined}
                    disabled={!isAvailable}
                    variant="ghost"
                    className="h-auto w-full justify-start px-3 py-3 text-left data-active:bg-accent data-active:text-accent-foreground"
                    onClick={() => openResult(result)}
                    onPointerMove={() => setActiveIndex(index)}
                  >
                    <Icon icon={presentation.icon} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium text-foreground">{result.title || "Untitled"}</span>
                      <span className="truncate text-xs font-normal text-muted-foreground">{result.summary || `No ${presentation.label.toLowerCase()} summary`}</span>
                    </span>
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">
                      {isAvailable ? presentation.label : "No page yet"}
                    </span>
                  </Button>
                );
              }) : null}
            </StaggerChildren>
          </div>
          {search.isFetching && !search.isPending ? (
            <span role="status" className="sr-only">Updating search results.</span>
          ) : null}
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>Tab filters</span>
          <span>↑↓ navigate · Enter open</span>
        </div>
        <DialogClose className="sr-only">Close search</DialogClose>
      </DialogContent>
    </Dialog>
  );
}
