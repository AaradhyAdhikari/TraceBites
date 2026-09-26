import Link from "next/link";
import { redirect } from "next/navigation";
import { requireFarmer } from "@/lib/session";
import { FarmerNav } from "@/components/FarmerNav";

export default async function FarmerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireFarmer();
  if (!ctx) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-surface">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <Link href="/farmer" className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.1em] text-muted truncate">
              {ctx.org.name}
            </p>
            <p className="text-[14px] font-semibold leading-tight truncate">
              {ctx.user.displayName}
            </p>
          </Link>
          <Link href="/logout" className="text-[13px] text-muted hover:text-ink shrink-0">
            Sign out
          </Link>
        </div>
      </header>

      <main className="flex-1 pb-20">{children}</main>

      <FarmerNav />
    </div>
  );
}
