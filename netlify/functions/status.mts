import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
  const store = getStore("commute-data");
  
  let dataPoints = 0;
  let lastFetch: string | null = null;
  
  try {
    const meta = await store.get("meta", { type: "json" }) as any;
    if (meta) {
      dataPoints = meta.dataPoints || 0;
      lastFetch = meta.lastFetch || null;
    }
  } catch (e) {
    // No meta yet
  }

  const apiKey = Netlify.env.get("GOOGLE_MAPS_API_KEY");

  return new Response(JSON.stringify({
    apiKeyConfigured: !!apiKey,
    dataPoints,
    lastFetch,
    status: "ok",
  }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/status",
};
