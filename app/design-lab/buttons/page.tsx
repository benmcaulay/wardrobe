import Link from "next/link";
import {
  Camera,
  Check,
  Clock,
  Close,
  Edit,
  Hanger,
  Plus,
  Refresh,
  Search,
  Sparkle,
  Trash,
  Upload,
} from "@/components/icons";
import { Button, SegmentedGroup, SegmentedOption } from "@/components/ui-button";
import {
  BUTTON_ICON_SIZE,
  type ButtonSize,
  type ButtonVariant,
} from "@/lib/ui-button-tokens";

export const metadata = { title: "Buttons · Design Lab" };

const VARIANTS: Array<{ id: ButtonVariant; label: string; note: string }> = [
  { id: "solid", label: "Solid", note: "One per view — the commit action" },
  { id: "outline", label: "Outline", note: "The default; hairline matches the 1.75 icon stroke" },
  { id: "quiet", label: "Quiet", note: "Tertiary — reads as text with a glyph" },
  { id: "accent", label: "Accent", note: "Sage, for affirmative or generative actions" },
  { id: "danger", label: "Danger", note: "Outlined, not filled — quieter than a red slab" },
];

const SIZES: ButtonSize[] = ["sm", "md", "lg"];

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs uppercase tracking-wide text-ink-muted">{title}</h2>
        {hint && <p className="mt-1 text-[11px] text-ink-muted">{hint}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-ink/10 bg-white p-4">
        {children}
      </div>
    </section>
  );
}

export default function ButtonsLabPage() {
  const md = BUTTON_ICON_SIZE.md;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-10">
      <nav className="text-xs text-ink-muted">
        <Link href="/design-lab" className="hover:text-ink">
          ← Design Lab
        </Link>
      </nav>

      <header>
        <h1 className="font-serif text-4xl tracking-tight">Buttons</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Drawn to the icon suite&apos;s rules: hairline borders in place of a 1.75 monoline stroke,
          full pill radius echoing round caps, and one <code className="text-ink">currentColor</code>{" "}
          shared by border, label and glyph.
        </p>
      </header>

      {VARIANTS.map((v) => (
        <Row key={v.id} title={v.label} hint={v.note}>
          <Button variant={v.id} icon={<Camera size={md} />}>
            Take photo
          </Button>
          <Button variant={v.id} icon={<Sparkle size={md} />}>
            Generate
          </Button>
          <Button variant={v.id}>No icon</Button>
          <Button variant={v.id} iconOnly icon={<Plus size={md} />} aria-label="Add a piece" />
          <Button variant={v.id} disabled icon={<Check size={md} />}>
            Disabled
          </Button>
        </Row>
      ))}

      <Row title="Sizes" hint="Each size carries its own glyph size, so icons stay optically level with the text">
        {SIZES.map((s) => (
          <Button key={s} size={s} variant="outline" icon={<Hanger size={BUTTON_ICON_SIZE[s]} />}>
            {s === "sm" ? "Small" : s === "md" ? "Medium" : "Large"}
          </Button>
        ))}
        {SIZES.map((s) => (
          <Button
            key={`${s}-only`}
            size={s}
            variant="solid"
            iconOnly
            icon={<Plus size={BUTTON_ICON_SIZE[s]} />}
            aria-label={`Add (${s})`}
          />
        ))}
      </Row>

      <Row title="Icon-only toolbar" hint="Circles, hairline — for control rows where labels would wrap">
        <Button variant="outline" iconOnly icon={<Edit size={md} />} aria-label="Crop" />
        <Button variant="outline" iconOnly icon={<Sparkle size={md} />} aria-label="Whiten background" />
        <Button variant="outline" iconOnly icon={<Refresh size={md} />} aria-label="Reset zoom" />
        <Button variant="outline" iconOnly icon={<Search size={md} />} aria-label="Search" />
        <Button variant="danger" iconOnly icon={<Trash size={md} />} aria-label="Delete" />
        <Button variant="quiet" iconOnly icon={<Close size={md} />} aria-label="Dismiss" />
      </Row>

      <Row title="Segmented" hint="One hairline around the group, not per option — the set reads as one object">
        <SegmentedGroup label="Self-timer">
          <Clock size={13} className="ml-1.5 mr-0.5 shrink-0 text-ink-muted" />
          <SegmentedOption active>Off</SegmentedOption>
          <SegmentedOption>3s</SegmentedOption>
          <SegmentedOption>10s</SegmentedOption>
        </SegmentedGroup>
        <SegmentedGroup label="Sort">
          <SegmentedOption>Recent</SegmentedOption>
          <SegmentedOption active>Colour</SegmentedOption>
          <SegmentedOption>Price</SegmentedOption>
        </SegmentedGroup>
      </Row>

      <Row title="In context" hint="A commit action beside its escapes — the pattern used across the app">
        <Button variant="solid" icon={<Upload size={md} />}>
          Add another view
        </Button>
        <Button variant="outline" icon={<Sparkle size={md} />}>
          Generate with AI
        </Button>
        <Button variant="quiet">Cancel</Button>
      </Row>
    </main>
  );
}
