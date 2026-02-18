import type { Context, Config } from "@netlify/functions";
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

async function fetchTrafficFromGoogle(origin: string, destination: string, apiKey: string) {
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
    throw new Error(`Google Maps API error: ${data.status} - ${data.error_message || "Unknown error"}`);
  }

  const route = data.routes[0];
  const leg = route.legs[0];

  // Use duration_in_traffic if available, otherwise fallback to duration
  const durationSeconds = leg.duration_in_traffic
    ? leg.duration_in_traffic.value
    : leg.duration.value;

  return {
    duration: Math.round(durationSeconds / 60),
    distance: leg.distance.text,
    summary: route.summary,
    durationText: leg.duration_in_traffic
      ? leg.duration_in_traffic.text
      : leg.duration.text,
  };
}

export default async (req: Request, context: Context) => {
  const store = getStore("commute-data");
  const apiKey = Netlify.env.get("GOOGLE_MAPS_API_KEY");

  if (!apiKey) {
    return new Response(JSON.stringify({
      error: "Google Maps API key not configured. Add GOOGLE_MAPS_API_KEY in Netlify environment variables.",
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get saved route
  let route: any;
  try {
    route = await store.get("route", { type: "json" });
  } catch (e) {
    return new Response(JSON.stringify({ error: "No route configured. Please save a route first." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!route) {
    return new Response(JSON.stringify({ error: "No route configured." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check direction
  const url = new URL(req.url);
  const direction = url.searchParams.get("direction") || "forward";

  const origin = direction === "forward" ? route.origin : route.destination;
  const destination = direction === "forward" ? route.destination : route.origin;

  try {
    const traffic = await fetchTrafficFromGoogle(origin, destination, apiKey);

    // Store this data point
    const record: TrafficRecord = {
      timestamp: new Date().toISOString(),
      direction,
      duration: traffic.duration,
      distance: traffic.distance,
      summary: traffic.summary,
      origin,
      destination,
    };

    // Append to history
    let history: TrafficRecord[] = [];
    try {
      const existing = await store.get("history", { type: "json" }) as TrafficRecord[] | null;
      if (existing && Array.isArray(existing)) {
        history = existing;
      }
    } catch (e) {
      // No history yet
    }

    history.push(record);

    // Keep last 2000 records
    if (history.length > 2000) {
      history = history.slice(-2000);
    }

    await store.setJSON("history", history);

    // Update meta
    await store.setJSON("meta", {
      dataPoints: history.length,
      lastFetch: record.timestamp,
    });

    return new Response(JSON.stringify({
      duration: traffic.duration,
      distance: traffic.distance,
      summary: traffic.summary,
      durationText: traffic.durationText,
      direction,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/traffic",
};
