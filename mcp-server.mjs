#!/usr/bin/env node

/**
 * RouteWise MCP Server
 * 
 * A Model Context Protocol server that provides commute optimization tools.
 * Connect this to Claude Code to ask natural language questions about your commute.
 * 
 * Tools provided:
 *   - check_traffic: Get current travel time for your route
 *   - best_departure: Get recommended departure time based on historical patterns
 *   - traffic_history: View recent traffic data points
 *   - save_route: Configure your commute route
 * 
 * Setup:
 *   1. Set GOOGLE_MAPS_API_KEY environment variable
 *   2. Add to Claude Code config (see README)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "routewise-data.json");

// ─── Data persistence ───

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    }
  } catch (e) {}
  return { route: null, history: [], alertPrefs: null };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ─── Google Maps API ───

async function fetchTraffic(origin, destination, apiKey) {
  const params = new URLSearchParams({
    origin,
    destination,
    departure_time: "now",
    traffic_model: "best_guess",
    key: apiKey,
  });

  const url = `https://maps.googleapis.com/maps/api/directions/json?${params}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK") {
    throw new Error(`Google Maps API error: ${data.status} - ${data.error_message || "Unknown"}`);
  }

  const route = data.routes[0];
  const leg = route.legs[0];
  const durationSec = leg.duration_in_traffic?.value || leg.duration.value;

  return {
    duration: Math.round(durationSec / 60),
    distance: leg.distance.text,
    summary: route.summary,
    durationText: leg.duration_in_traffic?.text || leg.duration.text,
  };
}

// ─── Analysis ───

function analyzeHistory(history) {
  if (history.length < 3) return null;

  const hourBuckets = {};
  history.forEach((r) => {
    // Skip weekends (Saturday=6, Sunday=0) in IST
    const date = new Date(r.timestamp);
    const istDate = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
    const istDay = istDate.getUTCDay();
    if (istDay === 0 || istDay === 6) return;

    const hour = new Date(r.timestamp).getHours();
    const key = `${r.direction}-${hour}`;
    if (!hourBuckets[key]) hourBuckets[key] = [];
    hourBuckets[key].push(r.duration);
  });

  const results = {};
  for (const dir of ["forward", "reverse"]) {
    let bestHour = -1;
    let bestAvg = Infinity;

    Object.entries(hourBuckets).forEach(([key, durations]) => {
      const [d, h] = key.split("-");
      if (d !== dir) return;
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      if (avg < bestAvg) {
        bestAvg = avg;
        bestHour = parseInt(h);
      }
    });

    const dirRecords = history.filter((r) => r.direction === dir);
    const durations = dirRecords.map((r) => r.duration);

    if (bestHour !== -1) {
      const ampm = bestHour >= 12 ? "PM" : "AM";
      const displayH = bestHour > 12 ? bestHour - 12 : bestHour === 0 ? 12 : bestHour;

      results[dir] = {
        bestTime: `${displayH}:00 ${ampm}`,
        bestHour,
        avgDuration: Math.round(bestAvg),
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations),
        overallAvg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
        dataPoints: durations.length,
      };
    }
  }

  return results;
}

// ─── MCP Server ───

const server = new Server(
  { name: "routewise", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "check_traffic",
      description:
        "Check current live traffic for your saved commute route. Returns travel time, distance, and route summary. Use direction 'forward' for origin→destination or 'reverse' for destination→origin.",
      inputSchema: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["forward", "reverse"],
            description: "Travel direction: forward (home→office) or reverse (office→home)",
            default: "forward",
          },
        },
      },
    },
    {
      name: "best_departure",
      description:
        "Get the recommended best departure time based on historical traffic patterns. Analyzes collected data to find the hour with consistently lowest travel time.",
      inputSchema: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["forward", "reverse"],
            description: "Which direction to analyze",
            default: "forward",
          },
        },
      },
    },
    {
      name: "traffic_history",
      description:
        "View recent traffic data points collected for your route. Shows timestamps, durations, and directions.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of recent records to return (default 20)",
            default: 20,
          },
          direction: {
            type: "string",
            enum: ["forward", "reverse", "both"],
            description: "Filter by direction",
            default: "both",
          },
        },
      },
    },
    {
      name: "save_route",
      description:
        "Save or update your commute route configuration. Provide origin and destination as text addresses.",
      inputSchema: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Starting point address" },
          destination: { type: "string", description: "Destination address" },
          timeFrom: { type: "string", description: "Monitoring start time (HH:MM)", default: "07:00" },
          timeTo: { type: "string", description: "Monitoring end time (HH:MM)", default: "22:00" },
        },
        required: ["origin", "destination"],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const data = loadData();

  switch (name) {
    case "check_traffic": {
      if (!apiKey) {
        return { content: [{ type: "text", text: "❌ GOOGLE_MAPS_API_KEY not set. Export it in your environment." }] };
      }
      if (!data.route) {
        return { content: [{ type: "text", text: "❌ No route configured. Use save_route first." }] };
      }

      const dir = args?.direction || "forward";
      const origin = dir === "forward" ? data.route.origin : data.route.destination;
      const dest = dir === "forward" ? data.route.destination : data.route.origin;

      try {
        const traffic = await fetchTraffic(origin, dest, apiKey);

        // Store data point
        data.history.push({
          timestamp: new Date().toISOString(),
          direction: dir,
          duration: traffic.duration,
          distance: traffic.distance,
          summary: traffic.summary,
          origin,
          destination: dest,
        });
        if (data.history.length > 2000) data.history = data.history.slice(-2000);
        saveData(data);

        const level = traffic.duration < 25 ? "🟢 Light" : traffic.duration < 40 ? "🟡 Moderate" : "🔴 Heavy";

        return {
          content: [{
            type: "text",
            text: `🚗 **Live Traffic: ${origin} → ${dest}**\n\n` +
              `• Duration: **${traffic.duration} minutes** (${traffic.durationText})\n` +
              `• Distance: ${traffic.distance}\n` +
              `• Route: ${traffic.summary}\n` +
              `• Condition: ${level}\n` +
              `• Checked: ${new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: `❌ Error: ${e.message}` }] };
      }
    }

    case "best_departure": {
      const analysis = analyzeHistory(data.history);
      if (!analysis) {
        return {
          content: [{
            type: "text",
            text: "📊 Not enough data yet. I need at least 3 data points to make recommendations. Use check_traffic a few times first, or wait for the scheduled collector to gather data.",
          }],
        };
      }

      const dir = args?.direction || "forward";
      const rec = analysis[dir];

      if (!rec) {
        return {
          content: [{
            type: "text",
            text: `📊 No data for ${dir} direction yet. Try check_traffic with direction="${dir}" first.`,
          }],
        };
      }

      return {
        content: [{
          type: "text",
          text: `🕐 **Best Departure Time (${dir === "forward" ? "To Office" : "To Home"})**\n\n` +
            `• Recommended: **${rec.bestTime}**\n` +
            `• Average duration at this hour: **${rec.avgDuration} min**\n` +
            `• Best ever recorded: ${rec.minDuration} min\n` +
            `• Worst ever recorded: ${rec.maxDuration} min\n` +
            `• Overall route average: ${rec.overallAvg} min\n` +
            `• You save ~${rec.maxDuration - rec.avgDuration} min vs peak\n` +
            `• Based on: ${rec.dataPoints} data points`,
        }],
      };
    }

    case "traffic_history": {
      const limit = args?.limit || 20;
      const dirFilter = args?.direction || "both";

      let records = data.history;
      if (dirFilter !== "both") {
        records = records.filter((r) => r.direction === dirFilter);
      }

      const recent = records.slice(-limit).reverse();

      if (recent.length === 0) {
        return {
          content: [{
            type: "text",
            text: "📋 No history yet. Use check_traffic to start collecting data.",
          }],
        };
      }

      const lines = recent.map((r) => {
        const time = new Date(r.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        const arrow = r.direction === "forward" ? "→" : "←";
        return `${time} | ${arrow} | ${r.duration} min | ${r.summary || ""}`;
      });

      return {
        content: [{
          type: "text",
          text: `📋 **Recent Traffic History** (${recent.length} records)\n\n` +
            `Time | Dir | Duration | Route\n` +
            `---|---|---|---\n` +
            lines.join("\n") +
            `\n\nTotal data points: ${data.history.length}`,
        }],
      };
    }

    case "save_route": {
      if (!args?.origin || !args?.destination) {
        return { content: [{ type: "text", text: "❌ Both origin and destination are required." }] };
      }

      data.route = {
        origin: args.origin,
        destination: args.destination,
        timeFrom: args.timeFrom || "07:00",
        timeTo: args.timeTo || "22:00",
        createdAt: new Date().toISOString(),
      };
      saveData(data);

      return {
        content: [{
          type: "text",
          text: `✅ Route saved!\n\n` +
            `• Origin: ${data.route.origin}\n` +
            `• Destination: ${data.route.destination}\n` +
            `• Monitoring: ${data.route.timeFrom} – ${data.route.timeTo} IST\n\n` +
            `You can now use check_traffic to get live data.`,
        }],
      };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  }
});

// Start
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("RouteWise MCP server running on stdio");
}

main().catch(console.error);
