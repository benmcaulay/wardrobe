"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DIRECTIONS } from "./mock-items";
import {
  LabDriftField,
  LabParallaxProvider,
  LabWorldShift,
  useLabDriftTheme,
} from "./lab-parallax";

function LabStage({ children }: { children: React.ReactNode }) {
  const theme = useLabDriftTheme();
  return (
    <div className="lab-stage">
      <LabWorldShift>
        <LabDriftField theme={theme} />
        <div className="lab-stage-body">{children}</div>
      </LabWorldShift>
    </div>
  );
}

export function DesignLabChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHub = pathname === "/design-lab";

  return (
    <LabParallaxProvider>
      <div className="lab-root">
        <div className="lab-picker" role="navigation" aria-label="Design directions">
          <Link href="/design-lab" className={`lab-picker-home ${isHub ? "is-active" : ""}`}>
            Lab
          </Link>
          {DIRECTIONS.map((d) => {
            const active = pathname.startsWith(d.href);
            return (
              <Link
                key={d.id}
                href={d.href}
                className={`lab-picker-link lab-picker-${d.id} ${active ? "is-active" : ""}`}
              >
                <span className="lab-picker-name">{d.name}</span>
                <span className="lab-picker-fonts">{d.fonts}</span>
              </Link>
            );
          })}
          <a href="/closet" className="lab-picker-exit">
            ← Live app
          </a>
        </div>
        <LabStage>{children}</LabStage>
      </div>
    </LabParallaxProvider>
  );
}
