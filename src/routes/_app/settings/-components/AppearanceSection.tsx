import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useCanvasThemePreference, useThemePreference } from "@/hooks/use-theme"
import {
  type CanvasThemePreference,
  setCanvasThemePreference,
  setThemePreference,
  type ThemeChoice,
} from "@/lib/theme"
import { cn } from "@/lib/utils"

type Option<T extends string> = {
  value: T
  label: string
  icon: typeof SunIcon
}

const THEME_OPTIONS: Array<Option<ThemeChoice>> = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
]

const CANVAS_OPTIONS: Array<Option<CanvasThemePreference>> = [
  { value: "match", label: "Match app", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
]

function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string
  options: Array<Option<T>>
  value: T
  onSelect: (value: T) => void
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-foreground">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        // A sunken well holding one raised keycap — the Etched form of a
        // segmented control.
        className="inline-flex rounded-md bg-well p-0.5 shadow-well"
      >
        {options.map((option) => {
          const selected = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                if (!selected) onSelect(option.value)
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[5px] border px-3 py-1.5 text-[13px] transition-colors",
                selected
                  ? "border-keycap-border bg-gradient-to-b from-keycap-from to-keycap-to font-medium text-foreground shadow-keycap"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <option.icon aria-hidden className="size-3.5" />
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Appearance block (spec §4.4): Theme picks Light / Dark for the app
// chrome, or System to follow the OS setting live; Canvas either follows it
// (Match app, the default) or pins the drawing canvas to a theme of its own
// (#111). Both stored on this browser only — these are the sole theme
// controls; the canvas has none of its own.
export function AppearanceSection() {
  const preference = useThemePreference()
  const canvasPreference = useCanvasThemePreference()

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-sm font-medium text-foreground">Appearance</h2>
        <p className="text-xs text-muted-foreground">
          Applies to this browser only
        </p>
      </div>

      <div className="space-y-4">
        <ChoiceGroup
          label="Theme"
          options={THEME_OPTIONS}
          value={preference}
          onSelect={setThemePreference}
        />
        <ChoiceGroup
          label="Canvas"
          options={CANVAS_OPTIONS}
          value={canvasPreference}
          onSelect={setCanvasThemePreference}
        />
      </div>
    </section>
  )
}
