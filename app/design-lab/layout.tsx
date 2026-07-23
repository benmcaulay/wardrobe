import "./design-lab.css";

import {
  Unbounded,
  Fragment_Mono,
  Big_Shoulders_Stencil_Display,
  Chakra_Petch,
  Gloock,
  Ojuju,
} from "next/font/google";
import { DesignLabChrome } from "./lab-chrome";

const unbounded = Unbounded({
  subsets: ["latin"],
  variable: "--lab-font-orbit-display",
  display: "swap",
});

const fragmentMono = Fragment_Mono({
  weight: "400",
  subsets: ["latin"],
  variable: "--lab-font-orbit-mono",
  display: "swap",
});

const bigShoulders = Big_Shoulders_Stencil_Display({
  subsets: ["latin"],
  variable: "--lab-font-runway-display",
  display: "swap",
});

const chakra = Chakra_Petch({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--lab-font-runway-ui",
  display: "swap",
});

const gloock = Gloock({
  weight: "400",
  subsets: ["latin"],
  variable: "--lab-font-stack-display",
  display: "swap",
});

const ojuju = Ojuju({
  subsets: ["latin"],
  variable: "--lab-font-stack-ui",
  display: "swap",
});

export const metadata = {
  title: "Design Lab · Wardrobe",
  description: "Three bold UI directions for the core closet experience.",
};

export default function DesignLabLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={[
        unbounded.variable,
        fragmentMono.variable,
        bigShoulders.variable,
        chakra.variable,
        gloock.variable,
        ojuju.variable,
      ].join(" ")}
    >
      <DesignLabChrome>{children}</DesignLabChrome>
    </div>
  );
}
