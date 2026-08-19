/**
 * Look an icon up by name.
 *
 * Gear stores its icon as a string, because the choice belongs to a database
 * row rather than to a component. This is the one place that turns that string
 * back into a drawing — kept out of `icons.tsx` because that file is generated
 * and a lookup table appended to it would be lost on the next regeneration.
 *
 * An unknown name falls back to the pouch rather than rendering nothing, so a
 * renamed or removed icon degrades to a generic bag instead of a hole in the
 * row.
 */

import { ICON_REGISTRY, Pouch, type IconProps } from "./icons";

const BY_NAME = new Map(ICON_REGISTRY.map((entry) => [entry.name, entry.Component]));

/** Every icon name gear is allowed to reference, for the picker. */
export const ICON_NAMES: readonly string[] = ICON_REGISTRY.map((entry) => entry.name);

export function GearIcon({ name, ...props }: IconProps & { name: string }) {
  const Component = BY_NAME.get(name) ?? Pouch;
  return <Component {...props} />;
}
