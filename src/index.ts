#!/usr/bin/env node
// x402-sms-mcp
//
// An MCP server that exposes a paid SMS-send tool to AI agents.
// Each `send_sms` tool call signs a USDC payment from the buyer wallet
// (env BUYER_PRIVATE_KEY) on Base Sepolia and POSTs to the seller at
// SMS_URL (defaults to the public x402-sms instance on Railway).
//
// Install in Claude Desktop / Cursor / Windsurf:
//   {
//     "mcpServers": {
//       "x402-sms": {
//         "command": "npx",
//         "args": ["-y", "x402-sms-mcp"],
//         "env": {
//           "BUYER_PRIVATE_KEY": "0x..."
//         }
//       }
//     }
//   }

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
const SMS_URL =
  process.env.SMS_URL ??
  "https://x402-sms-server-production.up.railway.app/send";

if (!PRIVATE_KEY || !PRIVATE_KEY.startsWith("0x")) {
  console.error(
    "x402-sms-mcp: BUYER_PRIVATE_KEY env var is required. " +
      "Set a 0x... key for a wallet funded with Base Sepolia ETH (gas) and USDC.",
  );
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);
const fetchWithPay = wrapFetchWithPayment(fetch, account);

const server = new Server(
  {
    name: "x402-sms",
    version: "0.1.0",
  },
  {
    capabilities: { tools: {} },
  },
);

// Map of Twilio error codes we surface with human context so the model can
// explain what happened. The keys come from Twilio's REST API error catalog
// at https://www.twilio.com/docs/api/errors.
const TWILIO_HINTS: Record<number, string> = {
  21211: "Invalid 'to' phone number. Must be E.164 format like +15551234567.",
  21408: "SMS sending is not permitted on the seller's Twilio account or number configuration.",
  21610: "The recipient has previously replied STOP and is on the opt-out list. They will not receive further messages until they reply START.",
  21614: "'to' is not a valid mobile number.",
  30007: "Message filtered by carrier (suspected spam / disallowed content).",
  30032: "The seller's toll-free number is still pending TFV approval. Messages won't deliver until Twilio finishes verification (typically 3-5 business days).",
  30034: "A2P 10DLC campaign not yet approved. Messages won't deliver until the brand + campaign clear vetting.",
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "send_sms",
      description:
        "Send one transactional SMS message to a US phone number. " +
        "Costs $0.03 USDC per message, paid automatically from the " +
        "configured wallet on Base Sepolia (testnet during beta, will " +
        "flip to Base mainnet at launch). Messages are sent from a Twilio " +
        "toll-free number and automatically get 'Reply STOP to opt out' " +
        "appended if not already present. " +
        "" +
        "CRITICAL — only call this tool when ALL of the following are true: " +
        "(1) the user has explicitly asked to text someone, or has previously " +
        "set up an automation that texts; (2) the recipient is the user " +
        "themselves OR someone the user has confirmed has consented to receive " +
        "texts from this automation; (3) the content is transactional or " +
        "informational (order updates, alerts, reminders, 2FA, agent task " +
        "completion notifications) — NOT marketing, promotion, or unsolicited " +
        "outreach. If unsure whether the recipient consented, ASK the user " +
        "before calling. Setting opt_in_attestation: true is the operator's " +
        "(user's) legal attestation that consent was obtained — it is not " +
        "a no-op flag. " +
        "" +
        "Use cases: 'text me when the long-running task finishes', " +
        "'send Mom an order confirmation for the gift I just bought her', " +
        "'remind me at 3pm to call the dentist by texting my cell'.",
      inputSchema: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description:
              "Recipient phone number in E.164 format: +1XXXXXXXXXX (US only).",
            pattern: "^\\+1\\d{10}$",
          },
          message: {
            type: "string",
            description:
              "SMS body. 1-1600 characters. Will be automatically suffixed " +
              "with ' Reply STOP to opt out.' if no opt-out language is present.",
            minLength: 1,
            maxLength: 1600,
          },
          opt_in_attestation: {
            type: "boolean",
            description:
              "Must be true. Operator's attestation that the recipient has " +
              "consented to receive this message. Setting this to true when " +
              "the recipient has NOT consented is a TCPA violation and exposes " +
              "the operator to statutory damages.",
            const: true,
          },
        },
        required: ["to", "message", "opt_in_attestation"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "send_sms") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = request.params.arguments as
    | { to?: string; message?: string; opt_in_attestation?: boolean }
    | undefined;

  const to = args?.to?.trim();
  const message = args?.message;
  const optIn = args?.opt_in_attestation;

  if (!to || !message || optIn !== true) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "Missing or invalid arguments. Required: `to` (E.164 format), " +
            "`message` (1-1600 chars), `opt_in_attestation: true`.",
        },
      ],
    };
  }

  try {
    const start = Date.now();
    const res = await fetchWithPay(SMS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, message, opt_in_attestation: optIn }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    const elapsedMs = Date.now() - start;

    if (!res.ok) {
      const twilioCode =
        typeof body.twilio_code === "number" ? body.twilio_code : undefined;
      const hint = twilioCode ? TWILIO_HINTS[twilioCode] : undefined;

      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `SMS send failed (HTTP ${res.status}, ${elapsedMs}ms)` +
              (hint ? `\n\nHint: ${hint}` : "") +
              `\n\nFull response:\n${JSON.stringify(body, null, 2)}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text:
            `SMS dispatched in ${elapsedMs}ms. $0.03 USDC settled on-chain.\n\n` +
            JSON.stringify(body, null, 2),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("x402-sms-mcp tool call failed:", message);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Tool call failed: ${message}`,
        },
      ],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

console.error(
  `x402-sms-mcp v0.1.0 ready. ` +
    `Buyer: ${account.address} | Target: ${SMS_URL}`,
);
