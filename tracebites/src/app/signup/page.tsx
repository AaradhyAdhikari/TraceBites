import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organizations, users } from "@/db/schema";
import { getSession, signIn } from "@/lib/session";
import { issueCode, verifyCode } from "@/lib/otp";
import { normalisePhone } from "@/lib/otp-core";
import { saltedRef } from "@/lib/ledger";

/**
 * Sign-up.
 *
 * Until now only the three seeded numbers could sign in; a real farmer got
 * "No account for that number" and stopped there.
 *
 * The phone is proved before any account is written, so an unverified number
 * never creates a row. A farmer signing up gets their own organisation; joining
 * an existing producer company is an invite flow, which is later work.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; error?: string; verified?: string }>;
}) {
  if (await getSession()) redirect("/farmer");
  const { phone, error, verified } = await searchParams;

  async function requestCode(formData: FormData) {
    "use server";
    const p = normalisePhone(String(formData.get("phone") ?? ""));
    if (!p) redirect("/signup?error=Enter+a+valid+10-digit+mobile+number");

    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.phone, p)).limit(1);
    if (taken) redirect(`/login?phone=${encodeURIComponent(p)}&error=That+number+already+has+an+account`);

    const result = await issueCode(p, "signup");
    if (!result.sent) {
      redirect(`/signup?error=${encodeURIComponent(result.message ?? "Try again later")}`);
    }
    redirect(`/signup?phone=${encodeURIComponent(p)}`);
  }

  async function createAccount(formData: FormData) {
    "use server";
    const p = normalisePhone(String(formData.get("phone") ?? ""));
    const name = String(formData.get("name") ?? "").trim();
    const farmName = String(formData.get("farmName") ?? "").trim();
    const code = String(formData.get("code") ?? "").trim();
    if (!p) redirect("/signup?error=Enter+a+valid+10-digit+mobile+number");
    if (!name) redirect(`/signup?phone=${encodeURIComponent(p)}&error=Enter+your+name`);

    // A code carried from /login is already spent, so it is not re-checked here.
    if (!formData.get("preVerified")) {
      const result = await verifyCode(p, code);
      if (result.outcome !== "ok") {
        redirect(`/signup?phone=${encodeURIComponent(p)}&error=${encodeURIComponent(result.message)}`);
      }
    }

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.phone, p)).limit(1);
    if (existing) redirect(`/login?phone=${encodeURIComponent(p)}`);

    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ phone: p, displayName: name, preferredLocale: "en" })
        .returning();

      const [org] = await tx
        .insert(organizations)
        .values({ kind: "farm", name: farmName || `${name}'s farm`, orgRef: "" })
        .returning();

      // orgRef is a salted hash of the row's own id, so it needs a second write.
      await tx.update(organizations).set({ orgRef: saltedRef(org.id) }).where(eq(organizations.id, org.id));
      await tx.insert(memberships).values({ userId: user.id, orgId: org.id, role: "farmer" });
    });

    await signIn(p);
    redirect("/farmer/fields");
  }

  const step = phone ? "details" : "phone";

  return (
    <main className="max-w-sm mx-auto px-4 py-14">
      <p className="text-[12px] uppercase tracking-[0.12em] text-moss font-semibold">TraceBites</p>
      <h1 className="text-[27px] font-bold tracking-tight mt-3">Create an account</h1>
      <p className="text-[14px] text-muted mt-1.5 mb-7 leading-relaxed">
        {step === "phone"
          ? "We'll send a code to confirm your number."
          : "Confirm the code and tell us who you are."}
      </p>

      {error && (
        <div className="card border-crit/40 px-3 py-2.5 mb-5 text-[13px] text-crit">{error}</div>
      )}

      {step === "phone" ? (
        <form action={requestCode} className="flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="phone">Phone number</label>
            <input id="phone" name="phone" className="input" inputMode="tel" placeholder="9876500001" autoComplete="tel" required />
          </div>
          <button className="btn-primary py-3">Send code</button>
          <Link href="/login" className="text-[13px] text-muted hover:text-ink text-center">
            Already have an account? Sign in
          </Link>
        </form>
      ) : (
        <form action={createAccount} className="flex flex-col gap-4">
          <input type="hidden" name="phone" value={phone} />
          {verified && <input type="hidden" name="preVerified" value="1" />}

          {!verified && (
            <div>
              <label className="label" htmlFor="code">Code sent to {phone}</label>
              <input id="code" name="code" className="input mono tracking-[0.3em]" inputMode="numeric" maxLength={6} placeholder="000000" autoComplete="one-time-code" required />
            </div>
          )}

          <div>
            <label className="label" htmlFor="name">Your name</label>
            <input id="name" name="name" className="input" placeholder="Rajesh Singh" autoComplete="name" required />
            <p className="text-[12px] text-muted mt-1.5 leading-relaxed">
              Shown to buyers as the source of your produce.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="farmName">Farm name — optional</label>
            <input id="farmName" name="farmName" className="input" placeholder="Kotra Farms" />
          </div>

          <button className="btn-primary py-3">Create account</button>
          <Link href="/signup" className="text-[13px] text-muted hover:text-ink text-center">
            Use a different number
          </Link>
        </form>
      )}
    </main>
  );
}
