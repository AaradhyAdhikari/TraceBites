"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Offers to fill the field's location from the phone's GPS, because the farmer
 * is usually standing in it. Typing coordinates by hand is possible but nobody
 * does it correctly, and a wrong location silently disables the geofence check.
 */
export function AddFieldForm({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [geoState, setGeoState] = useState<"idle" | "locating" | "ok" | "denied">("idle");

  useEffect(() => {
    if (!("geolocation" in navigator)) setGeoState("denied");
  }, []);

  function locate() {
    setGeoState("locating");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLng(p.coords.longitude.toFixed(6));
        setGeoState("ok");
      },
      () => setGeoState("denied"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <label className="label" htmlFor="name">Field name</label>
        <input id="name" name="name" className="input" required placeholder="Kotra Field" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="area">Area (hectares)</label>
          <input id="area" name="area" className="input" type="number" step="any" min="0" placeholder="2.4" />
        </div>
        <div>
          <label className="label" htmlFor="surveyNumber">Survey number</label>
          <input id="surveyNumber" name="surveyNumber" className="input" placeholder="SG/1234/A" />
        </div>
      </div>

      <div>
        <label className="label">Location</label>
        <button type="button" className="btn-ghost w-full" onClick={locate}>
          {geoState === "locating" ? "Getting location…" : lat ? "Update from my location" : "Use my current location"}
        </button>
        <input type="hidden" name="lat" value={lat} />
        <input type="hidden" name="lng" value={lng} />
        <p className="text-[12px] text-muted mt-1.5 leading-relaxed">
          {lat
            ? `Saved as ${lat}, ${lng}`
            : geoState === "denied"
              ? "Location unavailable. You can add the field now and set its location later, but harvests here will not be geo-checked."
              : "Stand in the field and tap the button. This is what the geofence check and weather advice use."}
        </p>
      </div>

      <div>
        <label className="label" htmlFor="certification">Certification</label>
        <select id="certification" name="certification" className="input" defaultValue="">
          <option value="">None</option>
          <option value="Certified Organic">Certified Organic</option>
          <option value="Transitional">Transitional (converting to organic)</option>
          <option value="Natural Farming">Natural Farming</option>
        </select>
      </div>

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary py-3" disabled={pending}>
      {pending ? "Adding…" : "Add field"}
    </button>
  );
}
