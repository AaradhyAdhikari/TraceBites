import Link from "next/link";

export default function Home() {
  return (
    <main className="max-w-lg mx-auto px-4 py-16">
      <p className="text-[12px] uppercase tracking-[0.12em] text-moss font-semibold">TraceBites</p>
      <h1 className="text-[34px] font-bold tracking-tight leading-[1.1] mt-4 text-balance">
        Every crate carries its own record.
      </h1>
      <p className="text-[16px] text-ink2 mt-4 leading-relaxed">
        A farmer registers a harvest and gets a code. Every hand-off after that is hashed the moment
        it happens and linked to the one before, so the record can be checked by someone who
        trusts none of the parties in it — including us.
      </p>

      <div className="flex flex-col gap-2.5 mt-8">
        <Link href="/farmer" className="btn-primary py-3">I&rsquo;m a farmer</Link>
        <Link href="/login" className="btn-ghost py-3">Sign in</Link>
      </div>

      <div className="card p-4 mt-8">
        <p className="label">Scan a code</p>
        <p className="text-[13.5px] text-muted leading-relaxed">
          Scanning the QR on a package opens its public record — no account, nothing to install. Try{" "}
          <Link href="/v/RS1234-WH5432-T" className="text-moss underline underline-offset-2">a seeded batch</Link>.
        </p>
      </div>

      <p className="text-[12px] text-muted mt-10 leading-relaxed">
        Phase 1 build — farmer registration, the ledger, and public verification. Distributor,
        retailer and consumer flows follow.
      </p>
    </main>
  );
}
