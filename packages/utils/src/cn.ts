import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Register the design-system radius, type, weight, and elevation tokens so they merge
// with their built-in groups; unknown `text-*`/`font-*`/`shadow-*` names would
// otherwise be read as colors or font families and evict real ones.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { borderRadius: ["pill"] },
    classGroups: {
      "font-size": [{ text: ["ui", "ui-compact", "small", "body"] }],
      "font-weight": [{ font: ["ui", "ui-medium"] }],
      shadow: [
        {
          shadow: [
            "raised",
            "floating",
            "overlay",
            "button-neutral",
            "button-contrast",
            "elements",
            "switch-knob",
            "keycap",
            "keycap-hover",
            "switch-on",
            "switch-off",
          ],
        },
      ],
    },
  },
});

/**
 * Combines multiple class names using clsx and merges Tailwind CSS classes intelligently.
 *
 * This utility function is essential for conditional className composition in React components,
 * especially when working with Tailwind CSS where class conflicts need to be resolved.
 *
 * @param inputs - Class values that can be strings, objects, arrays, or other types accepted by clsx
 * @returns A merged string of class names with Tailwind conflicts resolved
 *
 * @example
 * ```tsx
 * cn("px-2 py-1", "px-4") // => "py-1 px-4" (px-4 overrides px-2)
 * cn("text-muted-foreground", condition && "text-foreground") // Conditional classes
 * cn({ "bg-layer-2": isActive, "bg-card": !isActive }) // Object syntax
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
