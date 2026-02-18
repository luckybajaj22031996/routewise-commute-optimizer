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

  // Check if current time is within monitoring window
  const now = new Date();
  const istOffset = 5.5 * 60; // IST = UTC+5:30
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = utcMinutes + istOffset;
  const istHours = Math.floor(istMinutes / 60) % 24;
  const istMins = istMinutes % 60;

  const [fromH, fromM] = (route.timeFrom || "07:00").split(":").map(Number);
  const [toH, toM] = (route.timeTo || "22:00").split(":").map(Number);
  const currentMinutes = istHours * 60 + istMins;
  const fromMinutes = fromH * 60 + fromM;
  const toMinutes = toH * 60 + toM;

  if (currentMinutes < fromMinutes || currentMinutes > toMinutes) {
    console.log(`[Scheduled] Outside monitoring window (${route.timeFrom}-${route.timeTo} IST). Current: ${istHours}:${istMins}`);
    return;
  }

  // Fetch both directions
  let history: TrafficRecord[] = [];
  try {
    const existing = await store.get("history", { type: "json" }) as TrafficRecord[] | null;
    if (existing && Array.isArray(existing)) {
      history = existing;
    }
  } catch (e) {
    // Fresh start
  }

  // Forward: origin → destination
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
    console.log(`[Scheduled] Forward: ${fwd.duration} min`);
  } catch (e: any) {
    console.error(`[Scheduled] Forward fetch failed: ${e.message}`);
  }

  // Reverse: destination → origin
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
    console.log(`[Scheduled] Reverse: ${rev.duration} min`);
  } catch (e: any) {
    console.error(`[Scheduled] Reverse fetch failed: ${e.message}`);
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
