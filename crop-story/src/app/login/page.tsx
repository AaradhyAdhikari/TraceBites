import { redirect } from "next/navigation";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession, isValidOtpShape, sendOtp, signIn } from "@/lib/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; error?: string }>;
}) {
  const existing = await getSession();
  if (existing) redirect("/farmer");

  const { phone, error } = await searchParams;

  async function requestOtp(formData: FormData) {
    "use server";
    const p = String(formData.get("phone") ?? "").trim();
    if (!/^\+?\d{10,13}$/.test(p)) redirect("/login?error=Enter+a+valid+phone+number");
    await sendOtp(p);
    redirect(`/login?phone=${encodeURIComponent(p)}`);
  }

  async function verify(formData: FormData) {
    "use server";
    const p = String(formData.get("phone") ?? "").trim();
    const code = String(formData.get("code") ?? "").trim();
    // Development: any six digits are accepted and the real code is printed to
    // the server console. An SMS gateway replaces sendOtp/verify in Phase 5.
    if (!isValidOtpShape(code)) redirect(`/login?phone=${encodeURIComponent(p)}&error=Enter+the+6-digit+code`);
    const session = await signIn(p);
    if (!session) redirect(`/login?phone=${encodeURIComponent(p)}&error=No+account+for+that+number`);
    redirect("/farmer");
  }

  // Development convenience: show which seeded numbers work.
  const demoAccounts = await db
    .select({ phone: users.phone, name: users.displayName, role: memberships.role })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .limit(5);

  return (
    <main className="max-w-sm mx-auto px-4 py-14">
      <p className="text-[12px] uppercase tracking-[0.12em] text-moss font-semibold">Crop Story</p>
      <h1 className="text-[27px] font-bold tracking-tight mt-3">Sign in</h1>
      <p className="text-[14px] text-muted mt-1.5 mb-7 leading-relaxed">
        Your phone number — no email needed.
      </p>

      {error && (
        <div className="card border-crit/40 px-3 py-2.5 mb-5 text-[13px] text-crit">{error}</div>
      )}

      {!phone ? (
        <form action={requestOtp} className="flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="phone">Phone number</label>
            <input id="phone" name="phone" className="input" inputMode="tel" placeholder="9876500001" autoComplete="tel" />
          </div>
          <button className="btn-primary py-3">Send code</button>
        </form>
      ) : (
        <form action={verify} className="flex flex-col gap-4">
          <input type="hidden" name="phone" value={phone} />
          <div>
            <label className="label" htmlFor="code">
              Code sent to {phone}
            </label>
            <input id="code" name="code" className="input mono tracking-[0.3em]" inputMode="numeric" maxLength={6} placeholder="000000" autoFocus />
            <p className="text-[12px] text-muted mt-1.5">
              Development build — the code is printed in the server console, and any six digits work.
            </p>
          </div>
          <button className="btn-primary py-3">Sign in</button>
          <a href="/login" className="text-[13px] text-muted hover:text-ink text-center">Use a different number</a>
        </form>
      )}

      {demoAccounts.length > 0 && (
        <div className="card p-4 mt-8">
          <p className="label">Seeded accounts</p>
          <ul className="flex flex-col gap-1.5 mt-1">
            {demoAccounts.map((a) => (
              <li key={a.phone} className="flex justify-between text-[13px]">
                <span className="mono">{a.phone}</span>
                <span className="text-muted">{a.name} · {a.role}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
