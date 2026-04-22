"use client";

import { useState, useTransition } from "react";
import { ReferencePhotoManager, type ReferencePhotoListItem } from "@/components/reference-photo-manager";
import { StylePrefsEditor } from "@/components/style-prefs-editor";
import type { StylePrefs } from "@/lib/json";
import { finishOnboarding } from "@/lib/actions/preferences";

type Props = {
  photos: ReferencePhotoListItem[];
  initialPrefs: StylePrefs;
};

export function OnboardingFlow({ photos, initialPrefs }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(photos.length > 0 ? 2 : 1);
  const [prefs, setPrefs] = useState<StylePrefs>(initialPrefs);
  const [finishing, startFinish] = useTransition();

  const photosCount = photos.length;
  const canContinueFromStep2 = photosCount >= 1;

  function finish() {
    startFinish(async () => {
      await finishOnboarding(prefs);
    });
  }

  return (
    <div className="space-y-10">
      <ProgressBar step={step} />

      {step === 1 && (
        <section className="space-y-6 text-center">
          <h2 className="font-serif text-3xl tracking-tight">Welcome.</h2>
          <p className="text-ink-muted leading-relaxed max-w-md mx-auto">
            Wardrobe catalogs the clothes you already own, and — once you add a
            few reference photos — can generate a preview of how a new piece
            looks on you before you buy it.
          </p>
          <p className="text-xs text-ink-muted max-w-md mx-auto">
            Everything you upload stays on this machine. Nothing is sent to a
            cloud service in this phase.
          </p>
          <button
            type="button"
            onClick={() => setStep(2)}
            className="rounded-full bg-ink text-paper px-8 py-3 text-sm tracking-wide hover:bg-ink-soft transition"
          >
            Get started
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-6">
          <div>
            <h2 className="font-serif text-2xl tracking-tight">Reference photos</h2>
            <p className="text-ink-muted mt-2 text-sm max-w-2xl">
              Add 3–5 photos of yourself in neutral clothing, full body or
              waist-up, good lighting. Mark the one you&apos;d like the try-on
              engine to start from as primary. Photos stay on this machine.
            </p>
          </div>

          <ReferencePhotoManager photos={photos} maxRecommended={5} />

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-full border border-ink/15 px-5 py-2 text-sm hover:bg-paper-warm transition"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!canContinueFromStep2}
              className="rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
            >
              Continue
            </button>
            {!canContinueFromStep2 && (
              <span className="text-xs text-ink-muted">Add at least one photo to continue.</span>
            )}
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-6">
          <div>
            <h2 className="font-serif text-2xl tracking-tight">A few preferences</h2>
            <p className="text-ink-muted mt-2 text-sm max-w-2xl">
              Optional — skip anything you&apos;re not sure about. You can edit
              all of this later in Settings.
            </p>
          </div>

          <StylePrefsEditor value={prefs} onChange={setPrefs} disabled={finishing} />

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-full border border-ink/15 px-5 py-2 text-sm hover:bg-paper-warm transition"
            >
              Back
            </button>
            <button
              type="button"
              onClick={finish}
              disabled={finishing}
              className="rounded-full bg-ink text-paper px-6 py-2 text-sm tracking-wide hover:bg-ink-soft transition disabled:opacity-50"
            >
              {finishing ? "Finishing…" : "Finish"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function ProgressBar({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["Welcome", "Reference photos", "Preferences"] as const;
  return (
    <ol className="flex items-center gap-3 text-xs">
      {labels.map((label, i) => {
        const idx = (i + 1) as 1 | 2 | 3;
        const active = idx === step;
        const done = idx < step;
        return (
          <li key={label} className="flex items-center gap-3">
            <span
              className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-medium transition ${
                active
                  ? "bg-ink text-paper"
                  : done
                    ? "bg-accent text-white"
                    : "bg-paper-warm text-ink-muted"
              }`}
            >
              {done ? "✓" : idx}
            </span>
            <span className={active ? "text-ink" : "text-ink-muted"}>{label}</span>
            {idx < 3 && <span className="w-8 h-px bg-ink/10" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
