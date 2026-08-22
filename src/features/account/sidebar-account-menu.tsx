import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Logout01Icon from "@hugeicons/core-free-icons/Logout01Icon";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

import { deleteWorkspaceData, signOutCurrentDevice } from "./account-api";

const DELETE_CONFIRMATION = "RESET";

export function SidebarAccountMenu({ user }: { user: User | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setOpenMobile } = useSidebar();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [menuError, setMenuError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const displayName = String(
    user?.user_metadata.full_name ??
      user?.user_metadata.name ??
      user?.user_metadata.user_name ??
      "User",
  );
  const initial = displayName.charAt(0).toUpperCase();

  const signOut = useMutation({
    mutationFn: signOutCurrentDevice,
    onMutate: () => setMenuError(null),
    onSuccess: () => {
      queryClient.clear();
      setMenuOpen(false);
      setOpenMobile(false);
    },
    onError: (failure) => setMenuError(failure.message),
  });

  const deleteData = useMutation({
    mutationFn: deleteWorkspaceData,
    onMutate: () => setDeleteError(null),
    onSuccess: () => {
      queryClient.clear();
      setConfirmation("");
      setDeleteOpen(false);
      setOpenMobile(false);
      navigate("/", { replace: true });
    },
    onError: (failure) => setDeleteError(failure.message),
  });

  const setDeleteDialogOpen = (open: boolean) => {
    if (deleteData.isPending) return;
    setDeleteOpen(open);
    if (!open) {
      setConfirmation("");
      setDeleteError(null);
    }
  };

  const canDelete = confirmation === DELETE_CONFIRMATION && !deleteData.isPending;

  return (
    <>
      <SidebarMenuItem>
        <DropdownMenu
          open={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (open) setMenuError(null);
          }}
        >
          <DropdownMenuTrigger
            disabled={!user}
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={displayName}
                className="h-14 px-2 [&_[data-slot=icon]:last-child]:ml-auto group-data-[collapsible=icon]:[&_[data-slot=icon]:last-child]:hidden"
              />
            }
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-xl border border-sidebar-border bg-card text-sm font-normal text-foreground shadow-xs">
              {initial}
            </div>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
              <span className="truncate font-normal">{displayName}</span>
              <span className="truncate text-sm text-muted-foreground">{user?.email}</span>
            </div>
            <Icon icon={ArrowDown01Icon} />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64" align="start">
            <DropdownMenuItem
              closeOnClick={false}
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              <Icon icon={Logout01Icon} />
              {signOut.isPending ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Icon icon={Delete02Icon} />
              Delete my data
            </DropdownMenuItem>
            {menuError ? (
              <p role="alert" className="px-2.5 py-2 text-xs leading-5 text-destructive">
                {menuError}
              </p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all workspace data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes your notes, memories, conversations, relationships, evidence, and activity history. Your login and profile remain. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <label htmlFor="delete-workspace-confirmation" className="text-sm text-foreground">
              Type <span className="font-medium">{DELETE_CONFIRMATION}</span> to confirm
            </label>
            <Input
              id="delete-workspace-confirmation"
              autoComplete="off"
              autoFocus
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canDelete) deleteData.mutate();
              }}
              aria-invalid={Boolean(deleteError)}
            />
            {deleteError ? <p role="alert" className="text-sm text-destructive">{deleteError}</p> : null}
          </div>
          <AlertDialogFooter>
            <Button variant="ghost" disabled={deleteData.isPending} onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!canDelete} onClick={() => deleteData.mutate()}>
              {deleteData.isPending ? "Deleting…" : "Delete my data"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
