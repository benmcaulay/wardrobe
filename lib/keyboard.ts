/**
 * Whether a keystroke belongs to whatever the user is typing into.
 *
 * Any document-level shortcut on a single unmodified key has to ask this
 * first. Backspace is the sharp case: bound globally without a check, it
 * deletes the selected thing while someone is trying to correct a word in a
 * text box — the keystroke never reaches the field it was meant for.
 *
 * Structurally typed rather than taking an `Element`, so it can be tested
 * without a DOM.
 */
export type MaybeEditable = {
  tagName?: string;
  isContentEditable?: boolean;
} | null;

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function isTypingTarget(target: MaybeEditable): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return TYPING_TAGS.has((target.tagName ?? "").toUpperCase());
}
