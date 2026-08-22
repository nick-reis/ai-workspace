import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { AuthProvider } from "@/app/auth/auth-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initializeTheme } from "@/hooks/use-theme";
import App from "./App";
import "./index.css";

initializeTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <HashRouter>
            <App />
          </HashRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  </React.StrictMode>,
);
