/**
 * One global hotkey hook.
 *
 * The app is keyboard-first (CLAUDE.md §8), so exactly one listener owns the
 * shortcuts and views declare what they want. Views must not add competing global
 * listeners — that is how you end up with Space doing two things at once.
 *
 * The awkward part is not the binding, it is knowing when NOT to fire:
 *  - a digit typed into the numeric answer field belongs to the field
 *  - Space or Enter on a focused button belongs to the button (native activation)
 *  - Escape always belongs to the app, so a popover or session can be dismissed
 */

import { useEffect, useRef } from "react";

export type HotkeyHandler = (event: KeyboardEvent) => void;
export type HotkeyMap = Record<string, HotkeyHandler>;

function classify(target: EventTarget | null): { textField: boolean; activatable: boolean } {
  if (!(target instanceof HTMLElement)) return { textField: false, activatable: false };

  const tag = target.tagName;
  return {
    textField:
      tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable,
    activatable: tag === "BUTTON" || tag === "A",
  };
}

/**
 * `keys` maps a normalised key name to a handler. Digits are "1".."9"; use "Space",
 * "Enter", "Escape", "?" and single lowercase letters.
 */
export function useHotkeys(keys: HotkeyMap, enabled = true): void {
  // Held in a ref so re-renders do not tear down and rebind the listener on
  // every keystroke.
  const mapRef = useRef(keys);
  mapRef.current = keys;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const name = event.key === " " ? "Space" : event.key;
      const handler = mapRef.current[name];
      if (!handler) return;

      const { textField, activatable } = classify(event.target);

      if (name !== "Escape") {
        if (textField) return;
        if (activatable && (name === "Space" || name === "Enter")) return;
      }

      // Space scrolls and Enter can submit a form; both would fight the shortcut.
      if (name === "Space" || name === "Enter") event.preventDefault();

      handler(event);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
