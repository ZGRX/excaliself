import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A card's select box, above the stretched link. Hidden until hover or focus
 * on a mouse, unless a selection is under way; always shown on touch.
 */
export function SelectionCheckbox({
  name,
  checked,
  selecting,
  onToggle,
}: {
  name: string
  checked: boolean
  selecting: boolean
  onToggle: (extend: boolean) => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`Select ${name}`}
      onClick={(event) => onToggle(event.shiftKey)}
      className={cn(
        "pointer-events-auto absolute top-2 left-2 z-10 flex size-5 items-center justify-center rounded-[5px] border transition-[opacity,background-color,border-color] duration-150 outline-none focus-visible:ring-[2px] focus-visible:ring-ring/30",
        checked
          ? // Flat: any inset top light reads as a bevel at this size
            "border-iris bg-iris text-white"
          : "border-keycap-border bg-keycap-from text-transparent shadow-keycap hover:border-keycap-border-hover",
        !selecting &&
          "pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100",
      )}
    >
      <Check className="size-3.5" strokeWidth={3} />
    </button>
  )
}
