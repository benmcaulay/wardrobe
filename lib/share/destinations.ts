/**
 * Where a share can go.
 *
 * Only destinations that genuinely work from a web page are listed as
 * intents. Instagram, TikTok and Snapchat are deliberately absent: none of
 * them accept a prefilled post from the web, so a button for them could only
 * copy the link and ask you to paste it — a logo that promises something it
 * can't do. Use the OS share sheet for those; on a phone it offers them
 * natively.
 */

export type ShareDestinationId =
  | "copy"
  | "download"
  | "native"
  | "x"
  | "facebook"
  | "pinterest"
  | "whatsapp"
  | "reddit"
  | "email";

export type ShareDestination = {
  id: ShareDestinationId;
  label: string;
  /** Icon name in the suite (components/icons.tsx). */
  icon: string;
  /**
   * Builds the URL to open. Absent for actions handled in the client
   * (copy to clipboard, download, native share sheet).
   */
  href?: (args: { url: string; title: string; imageUrl?: string }) => string;
  /** Shown under the label in the share tab. */
  note?: string;
};

const enc = encodeURIComponent;

export const SHARE_DESTINATIONS: readonly ShareDestination[] = [
  { id: "copy", label: "Copy link", icon: "link" },
  { id: "download", label: "Download card", icon: "download" },
  {
    id: "native",
    label: "Share sheet",
    icon: "share",
    note: "Opens your phone's share menu — including Instagram and TikTok",
  },
  {
    id: "x",
    label: "X",
    icon: "brand-x",
    href: ({ url, title }) => `https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(title)}`,
  },
  {
    id: "facebook",
    label: "Facebook",
    icon: "brand-facebook",
    href: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
  },
  {
    id: "pinterest",
    label: "Pinterest",
    icon: "brand-pinterest",
    href: ({ url, title, imageUrl }) =>
      `https://pinterest.com/pin/create/button/?url=${enc(url)}&description=${enc(title)}` +
      (imageUrl ? `&media=${enc(imageUrl)}` : ""),
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: "brand-whatsapp",
    href: ({ url, title }) => `https://wa.me/?text=${enc(`${title} ${url}`)}`,
  },
  {
    id: "reddit",
    label: "Reddit",
    icon: "brand-reddit",
    href: ({ url, title }) => `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(title)}`,
  },
  {
    id: "email",
    label: "Email",
    icon: "mail",
    href: ({ url, title }) => `mailto:?subject=${enc(title)}&body=${enc(url)}`,
  },
];

/** Destinations that navigate somewhere; the rest are client-side actions. */
export function intentDestinations(): ShareDestination[] {
  return SHARE_DESTINATIONS.filter((d) => !!d.href);
}

export function actionDestinations(): ShareDestination[] {
  return SHARE_DESTINATIONS.filter((d) => !d.href);
}

export function getShareDestination(id: string): ShareDestination | undefined {
  return SHARE_DESTINATIONS.find((d) => d.id === id);
}
