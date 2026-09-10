"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { queueHarvest, pendingCount } from "@/lib/offline";

interface FarmOption {
  id: string;
  name: string;
  farmCode: string;
}
interface CropOption {
  id: string;
  name: string;
  nameHi: string | null;
  code: string;
  unit: string;
}

type Geo = { lat: number; lng: number; accuracy: number } | null;

export function HarvestForm({ farms, crops }: { farms: FarmOption[]; crops: CropOption[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [farmId, setFarmId] = useState(farms[0]?.id ?? "");
  const [cropId, setCropId] = useState(crops[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState(crops[0]?.unit ?? "kg");
  const [harvestedOn, setHarvestedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [askingPrice, setAskingPrice] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);

  const [geo, setGeo] = useState<Geo>(null);
  const [geoState, setGeoState] = useState<"idle" | "locating" | "ok" | "denied">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);

  // Ask for location on mount. It is what makes food-miles computed rather than
  // invented, and what the geofence check compares against.
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    setGeoState("locating");
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }) ||
        setGeoState("ok"),
      () => setGeoState("denied"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  useEffect(() => {
    pendingCount().then(setQueued).catch(() => {});
  }, []);

  function onCropChange(id: string) {
    setCropId(id);
    const c = crops.find((x) => x.id === id);
    if (c) setUnit(c.unit);
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6_000_000) {
      setError("That photo is larger than 6 MB. Try again with a smaller one.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      setError("Enter how much you harvested.");
      return;
    }

    const body = {
      farmId,
      cropVarietyId: cropId,
      quantity: qty,
      unit,
      harvestedOn: new Date(harvestedOn).toISOString(),
      askingPrice: askingPrice ? Number(askingPrice) : undefined,
      lat: geo?.lat,
      lng: geo?.lng,
      accuracy: geo?.accuracy,
      photo: photo ?? undefined,
      idempotencyKey: crypto.randomUUID(),
    };

    setBusy(true);

    // Offline is the normal case in a field, not an error state. Queue it and
    // tell the truth about what happened.
    if (!navigator.onLine) {
      await queueHarvest(body);
      setQueued(await pendingCount());
      setBusy(false);
      setError(null);
      alertSaved();
      return;
    }

    try {
      const res = await fetch("/api/harvests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: "Registration failed" }));
        throw new Error(j.error ?? "Registration failed");
      }
      const { code } = await res.json();
      router.push(`/farmer/batches/${code}?new=1`);
    } catch (err) {
      // A network failure mid-submit still shouldn't lose the harvest.
      await queueHarvest(body);
      setQueued(await pendingCount());
      setError(
        err instanceof Error && !navigator.onLine
          ? null
          : "Could not reach the server, so this harvest is saved on your phone and will register when you have signal.",
      );
      setBusy(false);
    }
  }

  function alertSaved() {
    setError(
      "Saved on your phone. It will register automatically the next time you have signal.",
    );
  }

  const selectedCrop = crops.find((c) => c.id === cropId);

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {queued > 0 && (
        <div className="card px-3 py-2.5 text-[13px] text-soil border-soil/40">
          {queued} harvest{queued > 1 ? "s" : ""} waiting to sync from this phone.
        </div>
      )}

      <div>
        <label className="label" htmlFor="farm">
          Field
        </label>
        <select
          id="farm"
          className="input"
          value={farmId}
          onChange={(e) => setFarmId(e.target.value)}
        >
          {farms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} · {f.farmCode}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="crop">
          Crop
        </label>
        <select id="crop" className="input" value={cropId} onChange={(e) => onCropChange(e.target.value)}>
          {crops.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.nameHi ? ` · ${c.nameHi}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <label className="label" htmlFor="qty">
            Quantity
          </label>
          <input
            id="qty"
            className="input"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0"
          />
        </div>
        <div>
          <label className="label" htmlFor="unit">
            Unit
          </label>
          <select id="unit" className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="kg">kg</option>
            <option value="quintal">quintal</option>
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="date">
          Harvested on
        </label>
        <input
          id="date"
          className="input"
          type="date"
          value={harvestedOn}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setHarvestedOn(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="price">
          Asking price (₹ per {unit}) — optional
        </label>
        <input
          id="price"
          className="input"
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={askingPrice}
          onChange={(e) => setAskingPrice(e.target.value)}
          placeholder="0"
        />
        <p className="text-[12px] text-muted mt-1.5 leading-relaxed">
          Recorded on the chain now, so the buyer cannot change it later. This is the figure the
          consumer sees as your share.
        </p>
      </div>

      <div>
        <label className="label">Photo of the harvest</label>
        <input
          ref={fileRef}
          id="photo"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPhoto}
          className="hidden"
        />
        <button type="button" className="btn-ghost w-full" onClick={() => fileRef.current?.click()}>
          {photo ? "Retake photo" : "Take photo"}
        </button>
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt="Harvest"
            className="mt-3 w-full rounded border border-line max-h-56 object-cover"
          />
        )}
        <p className="text-[12px] text-muted mt-1.5 leading-relaxed">
          Only the photo&rsquo;s fingerprint goes on the chain. The image itself stays private, but
          nobody can swap it for a different one later.
        </p>
      </div>

      <div className="card px-3 py-2.5 text-[12.5px] text-muted leading-relaxed">
        {geoState === "ok" && geo && (
          <>
            Location captured — {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)} (±
            {Math.round(geo.accuracy)} m)
          </>
        )}
        {geoState === "locating" && "Getting your location…"}
        {geoState === "denied" &&
          "Location is off. The harvest will still register, but it will be flagged for an inspector to check."}
        {geoState === "idle" && "Location unavailable on this device."}
      </div>

      {error && (
        <div className="card px-3 py-2.5 text-[13px] border-soil/40 text-soil leading-relaxed">
          {error}
        </div>
      )}

      <button className="btn-primary w-full py-3" disabled={busy}>
        {busy ? "Registering…" : `Register ${selectedCrop?.name ?? "harvest"}`}
      </button>
    </form>
  );
}
