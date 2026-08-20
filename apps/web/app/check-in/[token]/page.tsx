"use client";

import { FormEvent, useEffect, useState } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { CheckInResponse, apiErrorMessage, checkInPublic } from "@/lib/api";
import { StatusMessages } from "@/components/StatusMessages";

function getGeolocation(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  });
}

export default function CheckInPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string>("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [phoneLast4, setPhoneLast4] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckInResponse | null>(null);

  useEffect(() => {
    void params.then((value) => setToken(value.token));
  }, [params]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const geo = await getGeolocation();
      const response = await checkInPublic(
        token,
        employeeNumber,
        phoneLast4,
        geo?.latitude ?? null,
        geo?.longitude ?? null,
      );
      setResult(response);
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to confirm attendance"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="home">
      <section className="hero">
        <BrandLogo size={80} priority />
        <p className="eyebrow">NAIROBI CITY COUNTY</p>
        <h1>Attendance check-in</h1>
        <p className="subtitle">Environment Operations Platform</p>

        {result ? (
          <div className="checkin-result">
            <StatusMessages notice="Attendance confirmed." />
            <p>
              <strong>{result.employee?.fullName ?? "Identity verified"}</strong>
            </p>
            <p>
              Status: <span className={`badge ${result.status.toLowerCase()}`}>{result.status}</span>
            </p>
            <p className="subtitle">{new Date(result.checkedAt).toLocaleString()}</p>
          </div>
        ) : (
          <form className="auth-form" onSubmit={onSubmit}>
            <label htmlFor="employeeNumber">Employee number</label>
            <input
              id="employeeNumber"
              inputMode="numeric"
              autoComplete="off"
              placeholder="e.g. 20250100001"
              pattern="(19|20)\d{9}"
              value={employeeNumber}
              onChange={(e) => setEmployeeNumber(e.target.value)}
              required
            />
            <label htmlFor="phoneLast4">Last 4 digits of your phone number</label>
            <input
              id="phoneLast4"
              inputMode="numeric"
              autoComplete="tel"
              pattern="\d{4}"
              maxLength={4}
              value={phoneLast4}
              onChange={(event) => setPhoneLast4(event.target.value.replace(/\D/g, "").slice(0, 4))}
              required
            />
            <StatusMessages error={error} />
            <button type="submit" disabled={submitting}>
              {submitting ? "Confirming..." : "Confirm attendance"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
