import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

interface TrafficRecord {
  timestamp: string;
  direction: string;
  duration: number;
  distance: string;
  summary: string;
  origin: string;
  destination: string;
}

async function fetchTraffic(origin: string, destination: string, apiKey: string) {
  const params = new URLSearchParams({
    origin,
    destination,
    departure_time: "now",
    traffic_model: "best_guess",
    key: apiKey,
  });

  const url = `https://maps.googleapis.com/maps/api/directions/json?${params}`;
  const res = await fetch(url);
  const data = await res.json() as any;

  if (data.status !== "OK") {
    throw new Error(`Google Maps API: ${data.status}`);
  }

  const route = data.routes[0];
  const leg = route.legs[0];
  const durationSeconds = leg.duration_in_traffic?.value || leg.duration.value;

  return {
    duration: Math.round(durationSeconds / 60),
    distance: leg.distance.text,
    summary: route.summary,
  };
}

export default async (req: Request) => {
  const { next_run } = await req.json();
  console.log(`[Scheduled] Traffic collector running. Next: ${next_run}`);

  const apiKey = Netlify.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) {
    console.log("[Scheduled] No API key configured, skipping");
    return;
  }

  const store = getStore("commute-data");

  // Get route config
  let route: any;
  try {
    route = await store.get("route", { type: "json" });
  } catch (e) {
    console.log("[Scheduled] No route configured, skipping");
    return;
  }

  if (!route) {
    console.log("[Scheduled] No route found, skipping");
    return;
  }

  // Check if current IST time falls within a smart monitoring window
  // Morning window: 2 hours before reachOffice → fetch FORWARD (home → office)
  // Evening window: 2 hours before reachHome → fetch REVERSE (office → home)
  const now = new Date();
  const istOffset = 5.5 * 60; // IST = UTC+5:30
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = (utcMinutes + istOffset) % (24 * 60);
  const istHours = Math.floor(istMinutes / 60);
  const istMins = istMinutes % 60;
  const currentMinutes = istHours * 60 + istMins;

  const BUFFER = 120; // 2 hours before reach-by time

  const [officeH, officeM] = (route.reachOffice || "10:00").split(":").map(Number);
  const [homeH, homeM] = (route.reachHome || "20:00").split(":").map(Number);
  const officeMinutes = officeH * 60 + officeM;
  const homeMinutes = homeH * 60 + homeM;

  const morningStart = officeMinutes - BUFFER;
  const morningEnd = officeMinutes;
  const eveningStart = homeMinutes - BUFFER;
  const eveningEnd = homeMinutes;

  const inMorningWindow = currentMinutes >= morningStart && currentMinutes <= morningEnd;
  const inEveningWindow = currentMinutes >= eveningStart && currentMinutes <= eveningEnd;

  if (!inMorningWindow && !inEveningWindow) {
    console.log(`[Scheduled] Outside both windows. Morning: ${officeH - 2}:00-${route.reachOffice}, Evening: ${homeH - 2}:00-${route.reachHome} IST. Current: ${istHours}:${String(istMins).padStart(2, '0')}`);
    return;
  }

  // Fetch only the relevant direction(s)
  let history: TrafficRecord[] = [];
  try {
    const existing = await store.get("history", { type: "json" }) as TrafficRecord[] | null;
    if (existing && Array.isArray(existing)) {
      history = existing;
    }
  } catch (e) {
    // Fresh start
  }

  // Morning window → Forward only (home → office)
  if (inMorningWindow) {
    try {
      const fwd = await fetchTraffic(route.origin, route.destination, apiKey);
      history.push({
        timestamp: now.toISOString(),
        direction: "forward",
        duration: fwd.duration,
        distance: fwd.distance,
        summary: fwd.summary,
        origin: route.origin,
        destination: route.destination,
      });
      console.log(`[Scheduled] Morning window → Forward: ${fwd.duration} min`);
    } catch (e: any) {
      console.error(`[Scheduled] Forward fetch failed: ${e.message}`);
    }
  }

  // Evening window → Reverse only (office → home)
  if (inEveningWindow) {
    try {
      const rev = await fetchTraffic(route.destination, route.origin, apiKey);
      history.push({
        timestamp: now.toISOString(),
        direction: "reverse",
        duration: rev.duration,
        distance: rev.distance,
        summary: rev.summary,
        origin: route.destination,
        destination: route.origin,
      });
      console.log(`[Scheduled] Evening window → Reverse: ${rev.duration} min`);
    } catch (e: any) {
      console.error(`[Scheduled] Reverse fetch failed: ${e.message}`);
    }
  }

  // Keep last 2000 records
  if (history.length > 2000) {
    history = history.slice(-2000);
  }

  await store.setJSON("history", history);
  await store.setJSON("meta", {
    dataPoints: history.length,
    lastFetch: now.toISOString(),
  });

  console.log(`[Scheduled] Done. Total records: ${history.length}`);
};

export const config: Config = {
  // Run every 30 minutes
  schedule: "*/30 * * * *",
};
