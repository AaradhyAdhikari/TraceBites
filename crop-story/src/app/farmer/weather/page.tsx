import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { farms } from "@/db/schema";
import { requireFarmer } from "@/lib/session";
import { getForecast } from "@/lib/weather";
import { adviseAll, adviseIrrigation } from "@/lib/advisory";

export const dynamic = "force-dynamic";

const SUITABILITY_LABEL: Record<string, string> = {
  sow_now: "Good to sow",
  wait: "Wait",
  unsuitable: "Not suitable now",
  outside_window: "Out of season",
};

export default async function WeatherPage({
  searchParams,
}: {
  searchParams: Promise<{ field?: string }>;
}) {
  const ctx = (await requireFarmer())!; // layout already redirected if absent
  const { field: selectedId } = await searchParams;

  const myFarms = await db
    .select()
    .from(farms)
    .where(eq(farms.orgId, ctx.org.id))
    .orderBy(asc(farms.name));

  const located = myFarms.filter((f) => f.lat !== null && f.lng !== null);
  const field = located.find((f) => f.id === selectedId) ?? located[0];

  if (!field) {
    return (
      <div className="max-w-lg mx-auto px-4 py-6">
        <h1 className="text-[26px] font-bold tracking-tight">Weather</h1>
        <div className="card p-5 mt-5">
          <p className="text-[15px] font-semibold mb-1">No field with a location</p>
          <p className="text-[13.5px] text-muted leading-relaxed mb-4">
            Advice is specific to where a field actually is, so one of your fields needs a saved
            location before there is anything to show.
          </p>
          <Link href="/farmer/fields" className="btn-primary w-full">
            Add or update a field
          </Link>
        </div>
      </div>
    );
  }

  const { forecast, error } = await getForecast(field.lat!, field.lng!);
  const advice = adviseAll(forecast, new Date());
  const irrigation = adviseIrrigation(forecast);

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <h1 className="text-[26px] font-bold tracking-tight">Weather</h1>
      <p className="text-[14px] text-muted mt-1 mb-5">{field.name}</p>

      {located.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-5">
          {located.map((f) => (
            <Link
              key={f.id}
              href={`/farmer/weather?field=${f.id}`}
              className={`shrink-0 text-[13px] font-semibold px-3 py-1.5 rounded border ${
                f.id === field.id ? "border-moss text-moss bg-mossSoft" : "border-line text-muted"
              }`}
            >
              {f.name}
            </Link>
          ))}
        </div>
      )}

      {error ? (
        <div className="card px-4 py-3.5 border-soil/40 mb-6">
          <p className="text-[14px] font-semibold text-soil">{error}</p>
          <p className="text-[12.5px] text-muted mt-1 leading-relaxed">
            No sowing advice is shown, because advice built on a forecast we could not fetch would be
            a guess. Try again when you have a better connection.
          </p>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-7 gap-px bg-line border border-line rounded-md overflow-hidden mb-5">
            {forecast.map((d) => (
              <div key={d.date} className="bg-surface py-2.5 px-1 text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  {new Date(`${d.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short" })}
                </p>
                <p className="text-[14px] font-semibold mt-1 tabular-nums">
                  {Math.round(d.tempMaxC)}°
                </p>
                <p className="text-[11px] text-muted tabular-nums">{Math.round(d.tempMinC)}°</p>
                {d.rainMm >= 1 && (
                  <p className="text-[10px] text-chain mt-0.5 tabular-nums">
                    {Math.round(d.rainMm)}mm
                  </p>
                )}
              </div>
            ))}
          </section>

          <section
            className={`card px-4 py-3.5 mb-6 ${irrigation.action === "defer" ? "border-moss/40" : ""}`}
          >
            <p className="label mb-1">Irrigation</p>
            <p className="text-[15px] font-semibold">
              {irrigation.action === "defer" ? "Hold off watering" : "Irrigate as normal"}
            </p>
            <p className="text-[13px] text-muted mt-1 leading-relaxed">{irrigation.reason}</p>
          </section>
        </>
      )}

      <h2 className="text-[11px] uppercase tracking-[0.1em] text-muted mb-3">Sowing advice</h2>
      <ul className="flex flex-col gap-2">
        {advice.map((a) => (
          <li key={a.cropCode} className="card px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-[15.5px]">{a.name}</span>
              <span
                className={`text-[11px] px-1.5 py-0.5 rounded shrink-0 ${
                  a.suitability === "sow_now"
                    ? "bg-mossSoft text-moss"
                    : a.suitability === "outside_window"
                      ? "bg-surface2 text-muted"
                      : "bg-surface2 text-soil"
                }`}
              >
                {SUITABILITY_LABEL[a.suitability]}
              </span>
            </div>
            <p className="text-[13px] text-muted mt-1.5 leading-relaxed">{a.reason}</p>
          </li>
        ))}
      </ul>

      <p className="text-[12px] text-muted mt-6 leading-relaxed border-t border-line pt-4">
        This advice is a set of published agronomic rules — sowing windows and temperature bands from
        ICAR guidance — applied to the forecast for this field. It is not a prediction model and it
        does not know your soil. Treat it as a prompt to check, not an instruction.
      </p>
    </div>
  );
}
