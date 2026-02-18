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

function analyzePatterns(records: TrafficRecord[]) {
  if (records.length < 5) return null;

  // Group by hour and direction
  const hourBuckets: Record<string, number[]> = {};

  records.forEach((r) => {
    const hour = new Date(r.timestamp).getHours();
    const key = `${r.direction}-${hour}`;
    if (!hourBuckets[key]) hourBuckets[key] = [];
    hourBuckets[key].push(r.duration);
  });

  // Find best hour for forward direction
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

  // Overall stats
  const forwardRecords = records.filter((r) => r.direction === "forward");
  const reverseRecords = records.filter((r) => r.direction === "reverse");

  const forwardDurations = forwardRecords.map((r) => r.duration);
  const reverseDurations = reverseRecords.map((r) => r.duration);

  const forwardMax = forwardDurations.length > 0 ? Math.max(...forwardDurations) : 0;
  const reverseMax = reverseDurations.length > 0 ? Math.max(...reverseDurations) : 0;

  const forwardMin = forwardDurations.length > 0 ? Math.min(...forwardDurations) : 0;
  const reverseMin = reverseDurations.length > 0 ? Math.min(...reverseDurations) : 0;

  const forwardAvgAll = forwardDurations.length > 0
    ? Math.round(forwardDurations.reduce((a, b) => a + b, 0) / forwardDurations.length)
    : 0;
  const reverseAvgAll = reverseDurations.length > 0
    ? Math.round(reverseDurations.reduce((a, b) => a + b, 0) / reverseDurations.length)
    : 0;

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
      savings: forwardMax - Math.round(bestForwardAvg),
      direction: "forward",
      dayType: "Weekday",
    } : null,
    reverse: bestReverseHour !== -1 ? {
      bestTime: formatHour(bestReverseHour),
      avgDuration: Math.round(bestReverseAvg),
      minDuration: reverseMin,
      savings: reverseMax - Math.round(bestReverseAvg),
      direction: "reverse",
      dayType: "Weekday",
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

  const analysis = analyzePatterns(history);

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
