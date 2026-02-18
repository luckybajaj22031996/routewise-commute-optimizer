# RouteWise — Smart Commute Optimizer

A traffic intelligence tool that monitors your commute route, collects real-time data from Google Maps, and tells you the best time to leave. Built with Netlify Functions + MCP server for Claude Code integration.

## What It Does

- **Monitors traffic** on your route at regular intervals (every 30 min by default)
- **Collects historical data** to identify patterns (peak hours, best windows)
- **Recommends optimal departure time** based on actual data, not guessing
- **Web dashboard** to visualize traffic patterns and manage your route
- **MCP server** so you can ask Claude Code "should I leave now?" in natural language

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────┐
│  Web UI      │────▶│ Netlify Functions │────▶│ Google Maps   │
│  (Dashboard) │     │ (API Layer)      │     │ Directions API│
└─────────────┘     └──────────────────┘     └───────────────┘
                           │
                    ┌──────┴──────┐
                    │ Netlify     │
                    │ Blobs (DB)  │
                    └─────────────┘

┌─────────────┐     ┌──────────────────┐     ┌───────────────┐
│ Claude Code  │────▶│ MCP Server       │────▶│ Google Maps   │
│ (Terminal)   │     │ (Local Node.js)  │     │ Directions API│
└─────────────┘     └──────────────────┘     └───────────────┘
                           │
                    ┌──────┴──────┐
                    │ Local JSON  │
                    │ (Data File) │
                    └─────────────┘
```

## Setup

### Prerequisites

- **Google Maps API Key** with Directions API enabled
  - Go to [Google Cloud Console](https://console.cloud.google.com/)
  - Enable "Directions API"
  - Create an API key
  - (Optional) Restrict it to Directions API only

- **Netlify account** (for web deployment)
- **Node.js 18+** (for MCP server)
- **Claude Code** (for conversational interface)

### Step 1: Deploy to Netlify

1. Push this repo to GitHub
2. Connect to Netlify (or use `netlify deploy`)
3. Add environment variable in Netlify dashboard:
   - `GOOGLE_MAPS_API_KEY` = your Google Maps API key
4. Deploy!

The scheduled function will automatically start collecting traffic data every 30 minutes.

### Step 2: Set Up MCP Server for Claude Code

1. Install MCP SDK dependency:

```bash
cd routewise-commute-optimizer
npm install @modelcontextprotocol/sdk
```

2. Set your API key:

```bash
export GOOGLE_MAPS_API_KEY="your-key-here"
```

3. Add to Claude Code config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "routewise": {
      "command": "node",
      "args": ["/full/path/to/routewise-commute-optimizer/mcp-server.mjs"],
      "env": {
        "GOOGLE_MAPS_API_KEY": "your-key-here"
      }
    }
  }
}
```

4. Restart Claude Code. You can now ask:
   - "What's the traffic like right now?"
   - "Should I leave for office now?"
   - "What's the best time to leave today?"
   - "Show me my traffic history"

## MCP Tools Available

| Tool | Description |
|------|-------------|
| `check_traffic` | Get live travel time for your route |
| `best_departure` | Get recommended departure time from historical data |
| `traffic_history` | View recent traffic records |
| `save_route` | Configure your commute route |

## API Endpoints (Web)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | API status and data point count |
| `/api/route` | GET/POST | Get or save route configuration |
| `/api/traffic` | GET | Fetch live traffic (with `?direction=forward\|reverse`) |
| `/api/history` | GET | Get historical data + recommendations |
| `/api/alerts` | GET/POST | Get or save alert preferences |

## Project Structure

```
routewise-commute-optimizer/
├── public/
│   └── index.html              # Web dashboard (single-page app)
├── netlify/
│   └── functions/
│       ├── status.mts           # API status check
│       ├── route.mts            # Route save/load
│       ├── traffic.mts          # Live traffic fetch
│       ├── history.mts          # Historical data + analysis
│       ├── alerts.mts           # Alert preferences
│       └── collect-traffic-background.mts  # Scheduled data collector
├── mcp-server.mjs              # MCP server for Claude Code
├── claude_code_config.json     # Claude Code config example
├── netlify.toml                # Netlify config
├── package.json
└── README.md
```

## How the Recommendation Works

1. Data is collected at regular intervals (both directions)
2. Records are grouped by hour of day and direction
3. Average duration is calculated per hour bucket
4. The hour with the lowest average is recommended as "best departure time"
5. More data = better recommendations (give it 1-2 weeks for reliable patterns)

## Future Enhancements (Phase 2-4)

- [ ] Multi-user support with authentication
- [ ] WhatsApp/SMS alerts via Twilio
- [ ] Weather integration (rain affects traffic)
- [ ] Day-of-week pattern analysis (Monday vs Friday)
- [ ] Predictive model using ML
- [ ] Google Calendar integration (auto-suggest based on meetings)
- [ ] Multiple routes per user

## Built By

**Lucky Bajaj** — [luckybajaj.com](https://luckybajaj.com) · [Medium](https://medium.com/@imluckybajaj)

Born from a real problem: the Powai ↔ Andheri commute that varies by 30+ minutes depending on when you leave. Now, data decides.
