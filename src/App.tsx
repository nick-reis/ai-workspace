import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "@/app/layout/app-layout";

const GraphLabRoute = lazy(() => import("@/features/graph/graph-lab-route").then((module) => ({ default: module.GraphLabRoute })));
const ChatPage = lazy(() => import("@/features/chat/chat-page").then((module) => ({ default: module.ChatPage })));
const HomePage = lazy(() => import("@/features/home/home-page").then((module) => ({ default: module.HomePage })));
const HistoryPage = lazy(() => import("@/features/activity/history-page").then((module) => ({ default: module.HistoryPage })));
const SettingsPage = lazy(() => import("@/features/settings/settings-page").then((module) => ({ default: module.SettingsPage })));

function GraphLoadingScreen() {
  return (
    <main className="grid h-full min-h-[460px] place-items-center bg-background text-sm text-muted-foreground">
      Loading graph…
    </main>
  );
}

function PageLoadingScreen() {
  return <main className="grid h-full min-h-[460px] place-items-center bg-background text-sm text-muted-foreground">Loading…</main>;
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <main className="grid min-h-full place-items-center p-6 text-sm text-muted-foreground">
      {title} will be rebuilt here.
    </main>
  );
}

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Suspense fallback={<PageLoadingScreen />}><HomePage /></Suspense>} />
        <Route path="/chat" element={<Suspense fallback={<PageLoadingScreen />}><ChatPage /></Suspense>} />
        <Route path="/history" element={<Suspense fallback={<PageLoadingScreen />}><HistoryPage /></Suspense>} />
        <Route path="/search" element={<PlaceholderPage title="Search" />} />
        <Route
          path="/graph"
          element={<Suspense fallback={<GraphLoadingScreen />}><GraphLabRoute /></Suspense>}
        />
        <Route path="/settings" element={<Suspense fallback={<PageLoadingScreen />}><SettingsPage /></Suspense>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
