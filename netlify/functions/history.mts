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

function analyzePatterns(records: TrafficRecord[], reachOffice: string, reachHome: string) {
  if (records.length < 3) return null;

  const BUFFER = 2; // 2-hour monitoring window

  const [officeH] = reachOffice.split(":").map(Number);
  const [homeH] = reachHome.split(":").map(Number);

  // Forward: only consider hours within the morning window
  const forwardMinHour = officeH - BUFFER;
  const forwardMaxHour = officeH;

  // Reverse: only consider hours within the evening window
  const reverseMinHour = homeH - BUFFER;
  const reverseMaxHour = homeH;

  // Group by hour and direction
  const hourBuckets: Record<string, number[]> = {};

  records.forEach((r) => {
    const hour = new Date(r.timestamp).getHours();

    // Only include records within relevant windows
    if (r.direction === "forward" && (hour < forwardMinHour || hour > forwardMaxHour)) return;
    if (r.direction === "reverse" && (hour < reverseMinHour || hour > reverseMaxHour)) return;

    const key = `${r.direction}-${hour}`;
    if (!hourBuckets[key]) hourBuckets[key] = [];
    hourBuckets[key].push(r.duration);
  });

  // Find best hour per direction
  let bestForwardHour = -1;
  let bestForwardAvg = Infinity;
  let bestReverseHour = -1;
  let bestReverseAvg = Infinity;

  Object.entries(hourBuckets).forEach(([key, durations]) => {
    const [direction, hourStr] = key.split("-");
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const hour = parseInt(hourStr);

    if (direction === "forward" && avg < bestForwardAvg) {
      bestForwardAvg = avg;
      bestForwardHour = hour;
    }
    if (direction === "reverse" && avg < bestReverseAvg) {
      bestReverseAvg = avg;
      bestReverseHour = hour;
    }
  });

  // Overall stats per direction
  const forwardRecords = records.filter((r) => r.direction === "forward");
  const reverseRecords = records.filter((r) => r.direction === "reverse");

  const forwardDurations = forwardRecords.map((r) => r.duration);
  const reverseDurations = reverseRecords.map((r) => r.duration);

  const forwardMax = forwardDurations.length > 0 ? Math.max(...forwardDurations) : 0;
  const reverseMax = reverseDurations.length > 0 ? Math.max(...reverseDurations) : 0;

  const forwardMin = forwardDurations.length > 0 ? Math.min(...forwardDurations) : 0;
  const reverseMin = reverseDurations.length > 0 ? Math.min(...reverseDurations) : 0;

  const formatHour = (h: number) => {
    if (h === -1) return "--:--";
    const ampm = h >= 12 ? "PM" : "AM";
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${displayH}:00 ${ampm}`;
  };

  return {
    forward: bestForwardHour !== -1 ? {
      bestTime: formatHour(bestForwardHour),
      avgDuration: Math.round(bestForwardAvg),
      minDuration: forwardMin,
      maxDuration: forwardMax,
      savings: forwardMax - Math.round(bestForwardAvg),
      direction: "forward",
      dataPoints: forwardRecords.length,
    } : null,
    reverse: bestReverseHour !== -1 ? {
      bestTime: formatHour(bestReverseHour),
      avgDuration: Math.round(bestReverseAvg),
      minDuration: reverseMin,
      maxDuration: reverseMax,
      savings: reverseMax - Math.round(bestReverseAvg),
      direction: "reverse",
      dataPoints: reverseRecords.length,
    } : null,
  };
}

export default async (req: Request, context: Context) => {
  const store = getStore("commute-data");

  let history: TrafficRecord[] = [];
  try {
    const existing = await store.get("history", { type: "json" }) as TrafficRecord[] | null;
    if (existing && Array.isArray(existing)) {
      history = existing;
    }
  } catch (e) {
    // No history
  }

  // Load route config for reach-by times
  let route: any = null;
  try {
    route = await store.get("route", { type: "json" });
  } catch (e) {}

  const reachOffice = route?.reachOffice || "10:00";
  const reachHome = route?.reachHome || "20:00";

  const analysis = analyzePatterns(history, reachOffice, reachHome);

  // Return the forward recommendation by default
  const recommendation = analysis?.forward || analysis?.reverse || null;

  return new Response(JSON.stringify({
    records: history,
    recommendation,
    analysis,
    total: history.length,
  }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/history",
};
