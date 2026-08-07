import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ClosetNavDrawer } from "@/components/closet-nav-drawer";

/**
 * Shared chrome for every /closet route. The nav drawer lives here rather than
 * on each page so navigation is identical wherever you are — and so the panel
 * itself survives client-side transitions instead of remounting.
 */
export default async function ClosetLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { credits: true },
  });

  return (
    <>
      {children}
      <ClosetNavDrawer credits={dbUser?.credits ?? 0} />
    </>
  );
}
