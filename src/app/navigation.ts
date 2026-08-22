import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon";
import HierarchyIcon from "@hugeicons/core-free-icons/HierarchyIcon";
import Home01Icon from "@hugeicons/core-free-icons/Home01Icon";
import HistoryIcon from "@hugeicons/core-free-icons/HistoryIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";

import type { IconData } from "@/components/ui/icon";

export type NavigationItem = {
  title: string;
  path: string;
  icon: IconData;
  description: string;
};

export const primaryNavigation: NavigationItem[] = [
  {
    title: "Home",
    path: "/",
    icon: Home01Icon,
    description: "Your knowledge workspace",
  },
  {
    title: "Chat",
    path: "/chat",
    icon: BubbleChatIcon,
    description: "Reason over your knowledge graph",
  },
  {
    title: "Search",
    path: "/search",
    icon: Search01Icon,
    description: "Search your workspace",
  },
  {
    title: "Graph",
    path: "/graph",
    icon: HierarchyIcon,
    description: "Explore your knowledge graph",
  },
  {
    title: "History",
    path: "/history",
    icon: HistoryIcon,
    description: "Review auditable workspace changes",
  },
];

export const sidebarNavigation = primaryNavigation.filter((item) => item.path === "/" || item.path === "/graph");

export const settingsNavigation: NavigationItem = {
  title: "Settings",
  path: "/settings",
  icon: Settings01Icon,
  description: "Preferences and configuration",
};

export const navigation = [...primaryNavigation, settingsNavigation];
