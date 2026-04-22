import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseStylePrefs } from "@/lib/json";
import { OnboardingFlow } from "./onboarding-flow";

export default async function OnboardingPage() {
  const user = await requireUser();
  const [photos, dbUser] = await Promise.all([
    prisma.referencePhoto.findMany({
      where: { userId: user.id },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: { id: true, imagePath: true, isPrimary: true },
    }),
    prisma.user.findUnique({ where: { id: user.id }, select: { stylePrefs: true } }),
  ]);
  const initialPrefs = parseStylePrefs(dbUser?.stylePrefs);

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <header className="mb-8">
        <h1 className="font-serif text-4xl tracking-tight">Set up</h1>
      </header>
      <OnboardingFlow photos={photos} initialPrefs={initialPrefs} />
    </main>
  );
}
