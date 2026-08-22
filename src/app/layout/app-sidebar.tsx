import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Edit02Icon from "@hugeicons/core-free-icons/Edit02Icon";
import { isTauri } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type UIEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/app/auth/auth-context";
import {
  sidebarNavigation,
  settingsNavigation,
  type NavigationItem,
} from "@/app/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Icon } from "@/components/ui/icon";
import {
  deleteConversation,
  listConversationPage,
  renameConversation,
  type Conversation,
} from "@/features/chat/chat-api";
import { chatKeys } from "@/features/chat/query-keys";
import { graphKeys } from "@/features/graph/query-keys";
import { SidebarAccountMenu } from "@/features/account/sidebar-account-menu";

function NavigationMenuItem({ item }: { item: NavigationItem }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const isActive = location.pathname === item.path && (item.path !== "/chat" || !new URLSearchParams(location.search).has("conversation"));

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={item.title}
        onClick={() => {
          navigate(item.path);
          setOpenMobile(false);
        }}
      >
        <Icon icon={item.icon} />
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setOpenMobile } = useSidebar();
  const [chatError, setChatError] = useState<string | null>(null);
  const conversationContextMenuRef = useRef<Promise<Menu> | null>(null);
  const contextConversationRef = useRef<Conversation | null>(null);
  const contextActionsRef = useRef<{
    rename: (conversation: Conversation) => void;
    remove: (conversation: Conversation) => void;
  }>({ rename: () => undefined, remove: () => undefined });
  const selectedConversationId = location.pathname === "/chat"
    ? new URLSearchParams(location.search).get("conversation")
    : null;

  const conversations = useInfiniteQuery({
    queryKey: chatKeys.conversations,
    queryFn: ({ pageParam }) => listConversationPage(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
  });
  const conversationRows = useMemo(
    () => conversations.data?.pages.flatMap((page) => page.conversations) ?? [],
    [conversations.data],
  );

  const rename = useMutation({
    mutationFn: ({ conversation, title }: { conversation: Conversation; title: string }) => renameConversation(conversation, title),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: chatKeys.conversations }),
    onError: (failure) => setChatError(failure.message),
  });
  const remove = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_result, id) => {
      if (selectedConversationId === id) navigate("/chat", { replace: true });
      queryClient.removeQueries({ queryKey: chatKeys.messages(id) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      void queryClient.invalidateQueries({ queryKey: graphKeys.workspace });
    },
    onError: (failure) => setChatError(failure.message),
  });

  const openNewChat = () => {
    navigate("/chat", { state: { newChatRequest: crypto.randomUUID() } });
    setOpenMobile(false);
  };

  const openConversation = (conversationId: string) => {
    navigate(`/chat?conversation=${encodeURIComponent(conversationId)}`);
    setOpenMobile(false);
  };

  const requestRename = (conversation: Conversation) => {
    const title = window.prompt("Rename conversation", conversation.title)?.trim();
    if (title && title !== conversation.title) rename.mutate({ conversation, title });
  };

  const requestDelete = (conversation: Conversation) => {
    if (!window.confirm(`Delete “${conversation.title}” and all of its messages? This cannot be undone.`)) return;
    remove.mutate(conversation.id);
  };

  useEffect(() => {
    contextActionsRef.current = { rename: requestRename, remove: requestDelete };
  });

  const getConversationContextMenu = () => {
    if (!conversationContextMenuRef.current) {
      conversationContextMenuRef.current = Menu.new({
        items: [
          {
            id: "rename-conversation",
            text: "Rename",
            action: () => {
              const conversation = contextConversationRef.current;
              if (conversation) contextActionsRef.current.rename(conversation);
            },
          },
          { item: "Separator" },
          {
            id: "delete-conversation",
            text: "Delete",
            action: () => {
              const conversation = contextConversationRef.current;
              if (conversation) contextActionsRef.current.remove(conversation);
            },
          },
        ],
      });
    }
    return conversationContextMenuRef.current;
  };

  const openConversationContextMenu = async (event: MouseEvent<HTMLButtonElement>, conversation: Conversation) => {
    if (!isTauri()) return;
    event.preventDefault();
    contextConversationRef.current = conversation;
    try {
      await (await getConversationContextMenu()).popup();
    } catch (failure) {
      setChatError(failure instanceof Error ? failure.message : "The conversation menu could not be opened.");
    }
  };

  const loadMoreConversations = (event: UIEvent<HTMLDivElement>) => {
    const list = event.currentTarget;
    const nearEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 96;
    if (nearEnd && conversations.hasNextPage && !conversations.isFetchingNextPage) {
      void conversations.fetchNextPage();
    }
  };

  useEffect(() => () => {
    const menu = conversationContextMenuRef.current;
    conversationContextMenuRef.current = null;
    contextConversationRef.current = null;
    if (menu) void menu.then((resource) => resource.close()).catch(() => undefined);
  }, []);

  return (
    <Sidebar variant="sidebar" collapsible="icon" className="border-sidebar-border/80">
      <SidebarHeader className="relative z-10 shrink-0 bg-sidebar px-3 pt-4 pb-2 group-data-[collapsible=icon]:px-2">
        <SidebarMenu>
          <SidebarAccountMenu user={user} />
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent onScroll={loadMoreConversations} className="scroll-fade overflow-y-auto overscroll-contain px-1 group-data-[collapsible=icon]:scroll-fade-none group-data-[collapsible=icon]:px-0">
        <SidebarGroup className="pt-3">
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {sidebarNavigation.map((item) => (
                <NavigationMenuItem key={item.path} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="min-h-0 flex-1">
          <SidebarGroupLabel>Conversations</SidebarGroupLabel>
          <SidebarMenu className="mb-2 shrink-0">
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="New conversation"
                onClick={openNewChat}
              >
                <Icon icon={Edit02Icon} />
                <span>New conversation</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <SidebarGroupContent className="pr-1 group-data-[collapsible=icon]:hidden">
            <SidebarMenu>
              {conversations.isPending ? (
                <>
                  <SidebarMenuSkeleton />
                  <SidebarMenuSkeleton />
                  <SidebarMenuSkeleton />
                </>
              ) : null}
              {conversationRows.map((conversation) => (
                <SidebarMenuItem key={conversation.id}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={selectedConversationId === conversation.id}
                    tooltip={conversation.title || "Untitled conversation"}
                    onClick={() => openConversation(conversation.id)}
                    onContextMenu={(event) => void openConversationContextMenu(event, conversation)}
                  >
                    <span>{conversation.title || "Untitled conversation"}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {conversations.isFetchingNextPage ? <SidebarMenuSkeleton /> : null}
            </SidebarMenu>
            {!conversations.isPending && !conversationRows.length && !conversations.error ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No conversations yet.</p>
            ) : null}
            {chatError || conversations.error ? (
              <p role="alert" className="px-3 py-2 text-sm text-destructive">
                {chatError ?? (conversations.error ? "Conversations could not be loaded." : null) ?? "Chats could not be loaded."}
              </p>
            ) : null}
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>
      <SidebarFooter className="shrink-0 border-t border-sidebar-border/70 bg-sidebar px-3 py-3 group-data-[collapsible=icon]:px-2">
        <SidebarMenu>
          <NavigationMenuItem item={settingsNavigation} />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
