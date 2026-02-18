import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
  const store = getStore("commute-data");

  if (req.method === "GET") {
    try {
      const route = await store.get("route", { type: "json" });
      return new Response(JSON.stringify({ route }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ route: null }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (req.method === "POST") {
    try {
      const body = await req.json() as any;
      const { origin, destination, timeFrom, timeTo, interval } = body;

      if (!origin || !destination) {
        return new Response(JSON.stringify({ success: false, error: "Origin and destination are required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const route = {
        origin,
        destination,
        timeFrom: timeFrom || "07:00",
        timeTo: timeTo || "22:00",
        interval: interval || 30,
        createdAt: new Date().toISOString(),
      };

      await store.setJSON("route", route);

      return new Response(JSON.stringify({ success: true, route }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ success: false, error: e.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/route",
};
