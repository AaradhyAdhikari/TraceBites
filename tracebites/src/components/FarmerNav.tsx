"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Bottom navigation, not a sidebar.
 *
 * This is used one-handed, outdoors, on a phone. Targets are 56px tall and the
 * bar sits within thumb reach; a top nav would put every tap at the far end of
 * the screen. The labels are nouns, not features.
 */
const TABS = [
  { href: "/farmer", label: "Batches" },
  { href: "/farmer/fields", label: "Fields" },
];

export function FarmerNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 inset-x-0 border-t border-line bg-surface z-40">
      <div className="max-w-lg mx-auto grid grid-cols-2">
        {TABS.map((t) => {
          const active = t.href === "/farmer" ? pathname === "/farmer" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`h-14 flex items-center justify-center text-[13px] font-semibold border-t-2 transition-colors ${
                active
                  ? "border-moss text-moss"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
