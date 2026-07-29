import Link from "next/link";
import { DIRECTIONS } from "./mock-items";

export default function DesignLabHub() {
  return (
    <div className="lab-hub">
      <div className="lab-hub-inner lab-shift-mid">
        <h1 className="lab-shift-near">Three bold rebuilds of the core closet</h1>
        <p>
          Same functions — browse, filter, select, add — three experimental spatial languages.
          Open each direction, poke around, then tell me which pieces to merge into production.
        </p>
        <div className="lab-hub-grid">
          {DIRECTIONS.map((d, i) => (
            <Link
              key={d.id}
              href={d.href}
              className={`lab-hub-card ${d.id}`}
              style={{ ["--card-depth" as string]: String(0.4 + i * 0.18) }}
            >
              <div>
                <h2>{d.name}</h2>
                <p className="tag">{d.tagline}</p>
                <p className="fonts">{d.fonts}</p>
              </div>
              <ul>
                {d.beats.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
