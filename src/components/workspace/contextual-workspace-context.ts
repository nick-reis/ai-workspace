import { createContext, useContext } from "react";

export const ContextPanelCloseContext = createContext<() => void>(() => undefined);

export function useContextPanelClose() {
  return useContext(ContextPanelCloseContext);
}
