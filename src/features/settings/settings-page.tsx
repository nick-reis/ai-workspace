import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";

import { SettingRow, SettingsGroup } from "@/components/settings/settings-group";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/hooks/use-theme";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 p-5 sm:p-8 lg:p-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.035em] text-foreground">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">Shape the workspace around how you prefer to think and work.</p>
      </header>

      <SettingsGroup title="Appearance" description="Visual preferences are stored on this device.">
        <SettingRow
          icon={Moon02Icon}
          title="Dark mode"
          description="Use a darker, low-glare version of the same neutral interface."
          control={<Switch aria-label="Dark mode" checked={theme === "dark"} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} />}
        />
      </SettingsGroup>
    </main>
  );
}
