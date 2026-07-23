import Link from "next/link";
import { DIRECTIONS } from "./mock-items";

export default function DesignLabHub() {
  return (
    <div className="lab-hub">
      <div className="lab-hub-inner">
        <h1>Three bold rebuilds of the core closet</h1>
        <p>
          Same functions — browse, filter, select, add — three experimental spatial languages.
          Open each direction, poke around, then tell me which pieces to merge into production.
        </p>
        <div className="lab-hub-grid">
          {DIRECTIONS.map((d) => (
            <Link key={d.id} href={d.href} className={`lab-hub-card ${d.id}`}>
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
