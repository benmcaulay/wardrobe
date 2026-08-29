import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider, themeInitScript } from "@/components/theme-provider";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * `suppressHydrationWarning` is load-bearing, not a papered-over bug.
     *
     * `themeInitScript` runs before hydration and puts `dark` on this element
     * when the stored (or system) choice is Space — that is the whole point of a
     * blocking script, and it is the only way to avoid a paper-coloured flash on
     * every load. React then compares the className it rendered on the server
     * with the one in the DOM, finds an extra class, and warns. The mismatch is
     * intentional and confined to this attribute; nothing inside the tree
     * renders differently per theme (see components/theme-provider.tsx), so
     * there is nothing else for React to get wrong.
     */
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fraunces.variable} ${inter.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans min-h-dvh">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
