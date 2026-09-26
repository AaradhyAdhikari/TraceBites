import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession, signIn } from "@/lib/session";
import { issueCode, verifyCode } from "@/lib/otp";
import { normalisePhone } from "@/lib/otp-core";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; error?: string; sent?: string }>;
}) {
  const existing = await getSession();
  if (existing) redirect("/farmer");

  const { phone, error, sent } = await searchParams;

  async function requestCode(formData: FormData) {
    "use server";
    const raw = String(formData.get("phone") ?? "");
    const p = normalisePhone(raw);
    if (!p) redirect("/login?error=Enter+a+valid+10-digit+mobile+number");

    // Whether an account exists is not disclosed here: replying "no account" to
    // an unknown number turns this form into a way to test which numbers are
    // registered. The code is issued either way and fails at sign-in.
    const result = await issueCode(p, "signin");
    if (!result.sent) {
      redirect(`/login?phone=${encodeURIComponent(p)}&error=${encodeURIComponent(result.message ?? "Try again later")}`);
    }
    redirect(`/login?phone=${encodeURIComponent(p)}&sent=1`);
  }

  async function submitCode(formData: FormData) {
    "use server";
    const p = normalisePhone(String(formData.get("phone") ?? ""));
    const code = String(formData.get("code") ?? "").trim();
    if (!p) redirect("/login?error=Enter+a+valid+10-digit+mobile+number");

    const result = await verifyCode(p, code);
    if (result.outcome !== "ok") {
      redirect(`/login?phone=${encodeURIComponent(p)}&error=${encodeURIComponent(result.message)}`);
    }

    const session = await signIn(p);
    if (!session) {
      // The code was right but there is no account. Send them to signup with the
      // number carried over rather than making them prove the phone twice.
      redirect(`/signup?phone=${encodeURIComponent(p)}&verified=1`);
    }
    redirect("/farmer");
  }

  const showSeeded = process.env.NODE_ENV !== "production";
  const seeded = showSeeded
    ? await db.select({ phone: users.phone, name: users.displayName }).from(users).limit(3)
    : [];

  return (
    <main className="max-w-sm mx-auto px-4 py-14">
      <p className="text-[12px] uppercase tracking-[0.12em] text-moss font-semibold">TraceBites</p>
      <h1 className="text-[27px] font-bold tracking-tight mt-3">Sign in</h1>
      <p className="text-[14px] text-muted mt-1.5 mb-7 leading-relaxed">
        Your phone number — no email needed.
      </p>

      {error && (
        <div className="card border-crit/40 px-3 py-2.5 mb-5 text-[13px] text-crit">{error}</div>
      )}

      {!phone ? (
        <form action={requestCode} className="flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="phone">
              Phone number
            </label>
            <input
              id="phone"
              name="phone"
              className="input"
              inputMode="tel"
              placeholder="9876500001"
              autoComplete="tel"
              required
            />
          </div>
          <button className="btn-primary py-3">Send code</button>
          <Link href="/signup" className="text-[13px] text-muted hover:text-ink text-center">
            New here? Create an account
          </Link>
        </form>
      ) : (
        <form action={submitCode} className="flex flex-col gap-4">
          <input type="hidden" name="phone" value={phone} />
          <div>
            <label className="label" htmlFor="code">
              Code sent to {phone}
            </label>
            <input
              id="code"
              name="code"
              className="input mono tracking-[0.3em]"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              autoComplete="one-time-code"
              autoFocus
              required
            />
            <p className="text-[12px] text-muted mt-1.5 leading-relaxed">
              {sent ? "Valid for 5 minutes. " : ""}
              {showSeeded
                ? "Development build — the code is printed in the server console."
                : "It may take a moment to arrive."}
            </p>
          </div>
          <button className="btn-primary py-3">Sign in</button>
          <div className="flex justify-between text-[13px]">
            <Link href={`/login?phone=${encodeURIComponent(phone)}`} className="text-muted hover:text-ink">
              Resend
            </Link>
            <Link href="/login" className="text-muted hover:text-ink">
              Use a different number
            </Link>
          </div>
        </form>
      )}

      {showSeeded && seeded.length > 0 && (
        <div className="card p-4 mt-8">
          <p className="label">Seeded accounts</p>
          <ul className="flex flex-col gap-1.5 mt-1">
            {seeded.map((a) => (
              <li key={a.phone} className="flex justify-between text-[13px]">
                <span className="mono">{a.phone}</span>
                <span className="text-muted">{a.name}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-muted mt-3 leading-relaxed">
            Shown outside production only. The code itself still has to be correct.
          </p>
        </div>
      )}
    </main>
  );
}
