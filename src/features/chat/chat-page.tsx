import { useQuery, useQueryClient } from "@tanstack/react-query";
import Activity01Icon from "@hugeicons/core-free-icons/Activity01Icon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowUp01Icon from "@hugeicons/core-free-icons/ArrowUp01Icon";
import BookOpen01Icon from "@hugeicons/core-free-icons/BookOpen01Icon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import StopIcon from "@hugeicons/core-free-icons/StopIcon";
import { gsap } from "gsap";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Message, MessageContent } from "@/components/ui/message";
import { Markdown } from "@/components/ui/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContextualWorkspace } from "@/components/workspace/contextual-workspace";
import { activityKeys, hasMessageEvidence, listActivityPage, listRunActivity } from "@/features/activity/activity-api";
import { chatKeys } from "@/features/chat/query-keys";
import { graphKeys } from "@/features/graph/query-keys";
import { cn } from "@/lib/utils";
import type { ActivityItem, ChatEvent } from "@/types/graph";

import { ChatContextPanelContent } from "./chat-context-panel";
import { getChatContextPanelMetadata, type ChatPanelView } from "./chat-context-panel-definition";
import { listMessages, streamGraphChat, type ChatMessage } from "./chat-api";
import { mergeStreamMessages, takeStreamRevealChunk } from "./stream-presentation";

type ResponseReadyEvent = Extract<ChatEvent, { type: "response.ready" }>;

function toolLabel(name: string) {
  return name.replace(/^graph_/, "graph · ").replace(/^conversations_/, "conversations · ").replace(/^notes_/, "notes · ").replaceAll("_", " ");
}

function ResponseAction({ animate, delay = 0, children }: { animate: boolean; delay?: number; children: ReactNode }) {
  const actionRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const action = actionRef.current;
    if (!action || !animate) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tween = gsap.fromTo(action, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, delay: reduceMotion ? 0 : delay, duration: reduceMotion ? 0 : 0.4, ease: "power3.out", clearProps: "opacity,transform,visibility" });
    return () => { tween.kill(); };
  }, [animate, delay]);
  return <span ref={actionRef} className="inline-flex">{children}</span>;
}

function ResponseActions({ messageId, aiRunId, hasSources, needsReview, animateSources, animateReview, onOpen }: { messageId: string | null; aiRunId: string | null; hasSources: boolean; needsReview: boolean; animateSources: boolean; animateReview: boolean; onOpen: (view: NonNullable<ChatPanelView>) => void }) {
  if (!hasSources && !needsReview) return null;

  return (
    <div className="mt-2 flex items-center gap-1">
      {hasSources && messageId ? (
        <ResponseAction key="sources" animate={animateSources}>
          <Tooltip>
            <TooltipTrigger render={<Button aria-label="View sources" variant="ghost" size="icon-xs" className="size-7 bg-transparent text-muted-foreground/75 shadow-none hover:bg-transparent hover:text-foreground" onClick={() => onOpen({ mode: "sources", messageId })} />}><Icon icon={BookOpen01Icon} className="size-4" /></TooltipTrigger>
            <TooltipContent>View sources</TooltipContent>
          </Tooltip>
        </ResponseAction>
      ) : null}
      {needsReview && aiRunId ? (
        <ResponseAction key="review" animate={animateReview} delay={hasSources ? 0.08 : 0}>
          <Tooltip>
            <TooltipTrigger render={<Button aria-label="Review proposed changes" variant="ghost" size="icon-xs" className="size-7 bg-transparent text-amber-700 shadow-none hover:bg-transparent hover:text-amber-600 dark:text-amber-300 dark:hover:text-amber-200" onClick={() => onOpen({ mode: "review", aiRunId })} />}><Icon icon={Activity01Icon} className="size-4" /></TooltipTrigger>
            <TooltipContent>Review proposed changes</TooltipContent>
          </Tooltip>
        </ResponseAction>
      ) : null}
    </div>
  );
}

type DisplayMessage = {
  key: string;
  role: "user" | "assistant";
  content: string;
  messageId: string | null;
  aiRunId: string | null;
  hasSources: boolean;
  needsReview: boolean;
  showActions: boolean;
  animateSources: boolean;
  animateReview: boolean;
  animateSent: boolean;
  status: string | null;
};

function ConversationMessageRow({ item, onOpen }: { item: DisplayMessage; onOpen: (view: NonNullable<ChatPanelView>) => void }) {
  const messageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const message = messageRef.current;
    if (!message || !item.animateSent) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tween = gsap.fromTo(message, { autoAlpha: 0, y: 18, scale: 0.975 }, { autoAlpha: 1, y: 0, scale: 1, duration: reduceMotion ? 0 : 0.5, ease: "power3.out", clearProps: "transform" });
    return () => { tween.kill(); };
  }, [item.animateSent]);

  const isUser = item.role === "user";
  return (
    <div ref={messageRef}>
      <Message align={isUser ? "end" : "start"}>
        <MessageContent className={cn(isUser && "items-end")}>
          <div className={cn("text-sm leading-7", isUser ? "max-w-[85%] rounded-2xl border border-border/60 bg-secondary/75 px-4 py-2.5 shadow-2xs backdrop-blur-xl" : "w-full")}>
            {item.content ? (
              <Markdown onNodeCitationClick={!isUser && item.messageId
                ? (nodeId) => onOpen({ mode: "sources", messageId: item.messageId!, focusNodeId: nodeId })
                : undefined}
              >
                {item.content}
              </Markdown>
            ) : <span className="inline-flex items-center gap-2 text-muted-foreground"><Icon icon={Loading03Icon} className="size-4 animate-spin" />{item.status ?? "Thinking…"}</span>}
            {!isUser && item.showActions ? <ResponseActions messageId={item.messageId} aiRunId={item.aiRunId} hasSources={item.hasSources} needsReview={item.needsReview} animateSources={item.animateSources} animateReview={item.animateReview} onOpen={onOpen} /> : null}
          </div>
        </MessageContent>
      </Message>
    </div>
  );
}

export function ChatPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedId = searchParams.get("conversation");
  const newChatRequest = (location.state as { newChatRequest?: string } | null)?.newChatRequest;
  const [draft, setDraft] = useState("");
  const [pendingContent, setPendingContent] = useState<string | null>(null);
  const [streamedContent, setStreamedContent] = useState("");
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [streamConversationId, setStreamConversationId] = useState<string | null>(null);
  const [streamMessageId, setStreamMessageId] = useState<string | null>(null);
  const [streamAiRunId, setStreamAiRunId] = useState<string | null>(null);
  const [streamHasSources, setStreamHasSources] = useState(false);
  const [streamNeedsReview, setStreamNeedsReview] = useState(false);
  const [streamTextRevealComplete, setStreamTextRevealComplete] = useState(false);
  const [responseReadyPayload, setResponseReadyPayload] = useState<ResponseReadyEvent | null>(null);
  const [freshActionKeys, setFreshActionKeys] = useState<Set<string>>(() => new Set());
  const [panelView, setPanelView] = useState<ChatPanelView>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isPinnedToLatestRef = useRef(true);
  const scrollConversationRef = useRef<string | null>(selectedId);
  const panelConversationRef = useRef<string | null>(selectedId);
  const streamRef = useRef<AbortController | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const revealQueueRef = useRef("");
  const revealTimerRef = useRef<number | null>(null);
  const responseReadyRef = useRef(false);
  const revealCompletionRef = useRef<Promise<void>>(Promise.resolve());
  const resolveRevealRef = useRef<(() => void) | null>(null);
  const responseReadyControllerRef = useRef<AbortController | null>(null);
  const runMessageIdsRef = useRef(new Map<string, string>());
  const freshActionTimersRef = useRef(new Map<string, number>());
  const reviewOpenRequestRef = useRef(0);
  const pendingAutoReviewRunRef = useRef<string | null>(null);

  const markFreshActions = (keys: string[]) => {
    if (!keys.length) return;
    setFreshActionKeys((current) => new Set([...current, ...keys]));
    for (const key of keys) {
      const currentTimer = freshActionTimersRef.current.get(key);
      if (currentTimer !== undefined) window.clearTimeout(currentTimer);
      const timer = window.setTimeout(() => {
        freshActionTimersRef.current.delete(key);
        setFreshActionKeys((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }, 800);
      freshActionTimersRef.current.set(key, timer);
    }
  };

  const completeRevealIfReady = () => {
    if (!responseReadyRef.current || revealQueueRef.current || revealTimerRef.current !== null) return;
    setStreamTextRevealComplete(true);
    resolveRevealRef.current?.();
    resolveRevealRef.current = null;
  };

  const pumpReveal = () => {
    if (revealTimerRef.current !== null) return;
    const step = () => {
      revealTimerRef.current = null;
      if (!revealQueueRef.current) {
        completeRevealIfReady();
        return;
      }
      const next = takeStreamRevealChunk(revealQueueRef.current);
      revealQueueRef.current = next.remainder;
      setStreamedContent((current) => current + next.chunk);
      revealTimerRef.current = window.setTimeout(step, 28);
    };
    step();
  };

  const beginReveal = () => {
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = null;
    revealQueueRef.current = "";
    responseReadyRef.current = false;
    setStreamTextRevealComplete(false);
    revealCompletionRef.current = new Promise<void>((resolve) => { resolveRevealRef.current = resolve; });
  };

  const endReveal = () => {
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = null;
    revealQueueRef.current = "";
    resolveRevealRef.current?.();
    resolveRevealRef.current = null;
  };

  useEffect(() => () => {
    endReveal();
    for (const timer of freshActionTimersRef.current.values()) window.clearTimeout(timer);
    freshActionTimersRef.current.clear();
  }, []);

  const messages = useQuery({ queryKey: chatKeys.messages(selectedId), queryFn: () => listMessages(selectedId!), enabled: Boolean(selectedId) });
  const pendingReviews = useQuery({ queryKey: activityKeys.pendingPage, queryFn: () => listActivityPage({ limit: 50, state: "pending" }) });
  const reviewsByRun = useMemo(() => {
    const grouped = new Map<string, ActivityItem[]>();
    for (const item of pendingReviews.data?.items ?? []) {
      if (!item.ai_run_id) continue;
      const current = grouped.get(item.ai_run_id) ?? [];
      current.push(item);
      grouped.set(item.ai_run_id, current);
    }
    return grouped;
  }, [pendingReviews.data]);

  useEffect(() => {
    if (!streamTextRevealComplete || !responseReadyPayload) return;
    if (streamRef.current !== responseReadyControllerRef.current) return;

    const responseMessage = responseReadyPayload.response_message;

    const freshKeys: string[] = [];
    if (hasMessageEvidence(responseMessage)) freshKeys.push(`${responseMessage.id}:sources`);
    if (streamNeedsReview) freshKeys.push(`${responseMessage.id}:review`);
    markFreshActions(freshKeys);

    streamRef.current = null;
    setIsStreaming(false);
    setPendingContent(null);
    setStreamedContent("");
    setStreamStatus(null);
    setStreamConversationId(null);
    setStreamMessageId(null);
    setStreamAiRunId(null);
    setStreamHasSources(false);
    setStreamNeedsReview(false);
    setStreamTextRevealComplete(false);
    setResponseReadyPayload(null);
  }, [responseReadyPayload, streamNeedsReview, streamTextRevealComplete]);

  useEffect(() => {
    if (!newChatRequest) return;
    const resetTimer = window.setTimeout(() => {
      setDraft("");
      setError(null);
      setPanelView(null);
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [newChatRequest]);

  useEffect(() => {
    if (panelConversationRef.current !== selectedId) setPanelView(null);
    panelConversationRef.current = selectedId;
  }, [selectedId]);

  const showStream = isStreaming && (streamConversationId === selectedId || (selectedId === null && responseReadyPayload?.conversation_id === streamConversationId));
  const displayMessages = useMemo<DisplayMessage[]>(() => {
    const requestMessage = responseReadyPayload?.request_message;
    const responseMessage = responseReadyPayload?.response_message;
    const presentationIds = showStream && requestMessage && responseMessage ? new Set([requestMessage.id, responseMessage.id]) : null;
    const result: DisplayMessage[] = [];

    for (const message of messages.data ?? []) {
      if (message.role === "tool" || presentationIds?.has(message.id)) continue;
      const reviews = message.ai_run_id ? reviewsByRun.get(message.ai_run_id) ?? [] : [];
      result.push({
        key: message.id,
        role: message.role,
        content: message.content,
        messageId: message.id,
        aiRunId: message.ai_run_id,
        hasSources: hasMessageEvidence(message),
        needsReview: reviews.some((item) => item.available_actions.includes("approve") || item.available_actions.includes("reject")),
        showActions: message.role === "assistant",
        animateSources: freshActionKeys.has(`${message.id}:sources`),
        animateReview: freshActionKeys.has(`${message.id}:review`),
        animateSent: false,
        status: null,
      });
    }

    if (showStream && pendingContent) {
      result.push({ key: requestMessage?.id ?? "pending-request", role: "user", content: pendingContent, messageId: requestMessage?.id ?? null, aiRunId: null, hasSources: false, needsReview: false, showActions: false, animateSources: false, animateReview: false, animateSent: true, status: null });
    }
    if (showStream) {
      result.push({ key: responseMessage?.id ?? "pending-response", role: "assistant", content: streamedContent, messageId: streamMessageId, aiRunId: streamAiRunId, hasSources: streamHasSources, needsReview: streamNeedsReview, showActions: streamTextRevealComplete, animateSources: true, animateReview: true, animateSent: false, status: streamStatus });
    }
    return result;
  }, [freshActionKeys, messages.data, pendingContent, responseReadyPayload, reviewsByRun, showStream, streamAiRunId, streamHasSources, streamMessageId, streamedContent, streamNeedsReview, streamStatus, streamTextRevealComplete]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const conversationChanged = scrollConversationRef.current !== selectedId;
    scrollConversationRef.current = selectedId;
    if (conversationChanged) {
      isPinnedToLatestRef.current = true;
      setShowScrollButton(false);
    }
    if (isPinnedToLatestRef.current) viewport.scrollTo({ top: viewport.scrollHeight, behavior: conversationChanged ? "auto" : "smooth" });
  }, [messages.data, pendingContent, streamedContent, streamStatus, selectedId]);

  const trackScrollPosition = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const isPinned = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 72;
    isPinnedToLatestRef.current = isPinned;
    setShowScrollButton(!isPinned);
  };

  const scrollToLatest = () => {
    isPinnedToLatestRef.current = true;
    setShowScrollButton(false);
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" });
  };

  const finishStream = async (controller: AbortController, conversationId: string | null) => {
    if (streamRef.current !== controller) {
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
      void queryClient.invalidateQueries({ queryKey: graphKeys.workspace });
      return;
    }
    streamRef.current = null;
    setStreamStatus(null);
    await revealCompletionRef.current;
    if (conversationId) {
      panelConversationRef.current = conversationId;
      setStreamConversationId(conversationId);
      navigate(`/chat?conversation=${encodeURIComponent(conversationId)}`, { replace: true });
    }
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    if (conversationId) {
      try {
        const refreshedMessages = await queryClient.fetchQuery({ queryKey: chatKeys.messages(conversationId), queryFn: () => listMessages(conversationId), staleTime: 0 });
        queryClient.setQueryData(chatKeys.messages(conversationId), refreshedMessages);
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : "The completed response could not be refreshed.");
      }
    }
    setIsStreaming(false);
    setPendingContent(null);
    setStreamedContent("");
    setStreamConversationId(null);
    setStreamMessageId(null);
    setStreamAiRunId(null);
    setStreamHasSources(false);
    setStreamNeedsReview(false);
    setStreamTextRevealComplete(false);
    setResponseReadyPayload(null);
    void queryClient.invalidateQueries({ queryKey: activityKeys.all });
    void queryClient.invalidateQueries({ queryKey: graphKeys.workspace });
  };

  const openReviewForRun = (aiRunId: string) => {
    const request = reviewOpenRequestRef.current + 1;
    reviewOpenRequestRef.current = request;
    void queryClient.fetchQuery({ queryKey: activityKeys.run(aiRunId), queryFn: () => listRunActivity(aiRunId), staleTime: 0 })
      .then(() => {
        if (reviewOpenRequestRef.current === request) setPanelView({ mode: "review", aiRunId });
      }, () => {
        if (reviewOpenRequestRef.current === request) setPanelView({ mode: "review", aiRunId });
      });
    void queryClient.invalidateQueries({ queryKey: activityKeys.pendingPage });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isStreaming) return;
    const controller = new AbortController();
    streamRef.current = controller;
    setDraft("");
    setPendingContent(content);
    setStreamedContent("");
    setStreamStatus("Thinking…");
    setStreamConversationId(selectedId);
    setStreamMessageId(null);
    setStreamAiRunId(null);
    setStreamHasSources(false);
    setStreamNeedsReview(false);
    setResponseReadyPayload(null);
    pendingAutoReviewRunRef.current = null;
    beginReveal();
    setIsStreaming(true);
    setError(null);
    let completedConversationId = selectedId;
    try {
      await streamGraphChat({
        message: content,
        conversationId: selectedId,
        signal: controller.signal,
        onEvent: (streamEvent: ChatEvent) => {
          const isCurrentResponse = streamRef.current === controller;
          if (!isCurrentResponse) {
            if (streamEvent.type === "memory.proposed") {
              const messageId = runMessageIdsRef.current.get(streamEvent.ai_run_id);
              if (messageId) markFreshActions([`${messageId}:review`]);
              openReviewForRun(streamEvent.ai_run_id);
            } else if (streamEvent.type === "conversation.title.updated") {
              void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
            } else if (streamEvent.type === "done") {
              void queryClient.invalidateQueries({ queryKey: activityKeys.all });
              void queryClient.invalidateQueries({ queryKey: graphKeys.workspace });
            }
            return;
          }
          if (streamEvent.type === "message.delta") {
            setStreamStatus(null);
            revealQueueRef.current += streamEvent.delta;
            pumpReveal();
          } else if (streamEvent.type === "tool.started") {
            setStreamStatus(`Using ${toolLabel(streamEvent.name)}…`);
          } else if (streamEvent.type === "tool.completed") {
            setStreamStatus("Reviewing evidence…");
          } else if (streamEvent.type === "evidence") {
            setStreamHasSources(Boolean(streamEvent.nodes.length || streamEvent.searched_nodes?.length || streamEvent.edges.length || streamEvent.assertions?.length || streamEvent.paths?.length || streamEvent.messages?.length || streamEvent.searched_messages?.length || streamEvent.conversation_summaries?.length));
          } else if (streamEvent.type === "change.proposed") {
            setStreamAiRunId(streamEvent.ai_run_id);
            setStreamNeedsReview(true);
            pendingAutoReviewRunRef.current = streamEvent.ai_run_id;
          } else if (streamEvent.type === "memory.proposed") {
            setStreamStatus("Preparing a Memory suggestion…");
            setStreamAiRunId(streamEvent.ai_run_id);
            setStreamNeedsReview(true);
            pendingAutoReviewRunRef.current = streamEvent.ai_run_id;
          } else if (streamEvent.type === "memory.extraction.completed") {
            setStreamStatus(null);
            if (pendingAutoReviewRunRef.current) {
              openReviewForRun(pendingAutoReviewRunRef.current);
              pendingAutoReviewRunRef.current = null;
            }
          } else if (streamEvent.type === "conversation.title.updated") {
            void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
          } else if (streamEvent.type === "response.ready") {
            completedConversationId = streamEvent.conversation_id;
            queryClient.setQueryData<ChatMessage[]>(
              chatKeys.messages(streamEvent.conversation_id),
              (current) => mergeStreamMessages(current, [streamEvent.request_message, streamEvent.response_message]),
            );
            panelConversationRef.current = streamEvent.conversation_id;
            setStreamConversationId(streamEvent.conversation_id);
            if (selectedId !== streamEvent.conversation_id) {
              navigate(`/chat?conversation=${encodeURIComponent(streamEvent.conversation_id)}`, { replace: true });
            }
            void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
            setStreamMessageId(streamEvent.message_id);
            setStreamAiRunId(streamEvent.ai_run_id);
            runMessageIdsRef.current.set(streamEvent.ai_run_id, streamEvent.response_message.id);
            responseReadyControllerRef.current = controller;
            setResponseReadyPayload(streamEvent);
            responseReadyRef.current = true;
            completeRevealIfReady();
          } else if (streamEvent.type === "done") {
            completedConversationId = streamEvent.conversation_id;
            setStreamMessageId(streamEvent.message_id ?? null);
            setStreamAiRunId(streamEvent.ai_run_id);
            responseReadyRef.current = true;
            completeRevealIfReady();
            if (pendingAutoReviewRunRef.current) {
              openReviewForRun(pendingAutoReviewRunRef.current);
              pendingAutoReviewRunRef.current = null;
            }
          } else if (streamEvent.type === "error") {
            throw new Error(streamEvent.message);
          }
        },
      });
      await finishStream(controller, completedConversationId);
    } catch (failure) {
      if (streamRef.current !== controller) return;
      streamRef.current = null;
      setIsStreaming(false);
      setPendingContent(null);
      setStreamedContent("");
      setStreamStatus(null);
      setStreamConversationId(null);
      setStreamMessageId(null);
      setStreamAiRunId(null);
      setStreamHasSources(false);
      setStreamNeedsReview(false);
      setStreamTextRevealComplete(false);
      setResponseReadyPayload(null);
      pendingAutoReviewRunRef.current = null;
      endReveal();
      setDraft(content);
      setError(failure instanceof DOMException && failure.name === "AbortError" ? "Response stopped." : failure instanceof Error ? failure.message : "Chat failed.");
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      if (selectedId) void queryClient.invalidateQueries({ queryKey: chatKeys.messages(selectedId) });
    }
  };

  const contextPanel = panelView
    ? { ...getChatContextPanelMetadata(panelView), content: <ChatContextPanelContent view={panelView} /> }
    : null;

  return (
    <ContextualWorkspace panel={contextPanel} onPanelClose={() => setPanelView(null)} panelWidthStorageKey="chat_context_panel_width">
        <div className="relative min-h-0 flex-1">
          <div ref={viewportRef} onScroll={trackScrollPosition} className="scroll-fade size-full overflow-y-auto overscroll-contain">
            <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-8 px-4 pt-8 pb-36 sm:px-6 sm:pb-40">
              {!messages.isLoading && !showStream && (!selectedId || messages.data?.length === 0) ? <div className="m-auto max-w-md text-center"><h2 className="text-xl font-semibold">How can I help?</h2><p className="mt-2 text-sm text-muted-foreground">Ask about your knowledge graph or request a safe change.</p></div> : null}
              {messages.isLoading ? <div className="space-y-8"><Skeleton className="ml-auto h-12 w-2/5 rounded-3xl" /><div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div></div> : null}
              {displayMessages.map((item) => <ConversationMessageRow key={item.key} item={item} onOpen={setPanelView} />)}
            </div>
          </div>
          <Button aria-label="Scroll to latest message" title="Scroll to latest message" variant="secondary" size="icon-sm" onClick={scrollToLatest} className={cn("absolute bottom-28 left-1/2 -translate-x-1/2 border border-border/70 bg-card/80 text-foreground shadow-sm backdrop-blur-xl transition-all sm:bottom-32", showScrollButton ? "scale-100 opacity-100" : "pointer-events-none translate-y-2 scale-95 opacity-0")}><Icon icon={ArrowDown01Icon} /></Button>
        </div>

        <form onSubmit={submit} className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-linear-to-t from-background via-background/90 to-transparent px-3 pt-10 pb-4 sm:px-6 sm:pb-6">
          {error || messages.error || pendingReviews.error ? <p role="alert" className="pointer-events-auto mx-auto mb-2 max-w-4xl rounded-lg bg-card/85 px-3 py-2 text-sm text-destructive shadow-xs backdrop-blur-xl">{error ?? messages.error?.message ?? pendingReviews.error?.message ?? "Chat data could not be loaded."}</p> : null}
          <div className="pointer-events-auto mx-auto flex w-full max-w-4xl items-end gap-2 rounded-2xl border border-border/75 bg-card/80 p-2 shadow-[0_18px_50px_-24px_rgba(20,20,18,0.38),0_2px_8px_-4px_rgba(20,20,18,0.12)] backdrop-blur-2xl transition-[background-color,border-color,box-shadow] focus-within:border-foreground/20 focus-within:bg-card/95 focus-within:shadow-[0_22px_60px_-26px_rgba(20,20,18,0.42),0_3px_10px_-5px_rgba(20,20,18,0.14)]">
            <textarea value={draft} onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} rows={2} placeholder="Ask about your knowledge…" className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground" />
            {isStreaming ? <Button aria-label="Stop response" title="Stop response" size="icon" type="button" onClick={() => streamRef.current?.abort()}><Icon icon={StopIcon} /></Button> : <Button aria-label="Send message" title="Send message" size="icon" type="submit" disabled={!draft.trim()}><Icon icon={ArrowUp01Icon} /></Button>}
          </div>
        </form>
    </ContextualWorkspace>
  );
}
