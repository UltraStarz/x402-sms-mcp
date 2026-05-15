# x402-sms-mcp

A paid MCP server that lets AI agents send SMS messages to US phone numbers.

Each `send_sms` tool call:
1. Sends a transactional SMS via a verified toll-free number
2. Auto-appends `Reply STOP to opt out` if the body doesn't include opt-out language
3. Costs **$0.03 USDC** per message, paid automatically from the configured wallet via [x402](https://x402.org)

No API keys. No Twilio account. The agent pays the toll, the message goes out.

> **Status: Public beta on Base Sepolia (testnet).** The seller's toll-free number is undergoing Twilio TFV approval (typically 3-5 business days from May 2026). During this window the payment flow works end-to-end on chain but Twilio will reject undelivered messages with code `30032`. Once approved, messages will deliver and pricing flips to Base mainnet.

## Install in Claude Desktop / Cursor / Windsurf

Add this to your MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "x402-sms": {
      "command": "npx",
      "args": ["-y", "x402-sms-mcp"],
      "env": {
        "BUYER_PRIVATE_KEY": "0xYOUR_PRIVATE_KEY"
      }
    }
  }
}
```

Restart your MCP client. A `send_sms` tool will appear.

## What you need

A wallet on **Base Sepolia** (testnet) funded with:

- A small amount of ETH for gas (free from <https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet>)
- USDC for payments (free from <https://faucet.circle.com>, select Base Sepolia)

Generate a throwaway key:

```bash
node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.log('PRIVATE_KEY=',k);console.log('ADDRESS=',privateKeyToAccount(k).address)"
```

Use the printed address to claim from faucets, then put the printed key into your MCP config.

## Try it

In Claude Desktop, ask:

> Text my cell at +15551234567 when this long-running task finishes. The recipient (me) consents to receive this message.

Claude will call `send_sms` with `opt_in_attestation: true`. You'll get back a Twilio SID + the on-chain settlement hash. The transfer is visible at <https://sepolia.basescan.org>.

## Compliance — please read

This MCP wraps a **regulated SMS gateway**. The operator (you) is responsible for ensuring every recipient has consented to receive messages before invoking `send_sms`. The `opt_in_attestation: true` argument is your legal attestation under TCPA and CTIA short-code/long-code rules.

Do NOT use this MCP to:
- Send marketing or promotional content
- Text strangers, scraped lists, or anyone who hasn't opted in
- Send to non-US numbers (the seller currently rejects non-`+1` E.164)
- Send anything related to S.H.A.F.T.-C (Sex, Hate, Alcohol, Firearms, Tobacco, Cannabis)

The seller-side automatically:
- Appends `Reply STOP to opt out` to every message
- Honors carrier-level STOP/HELP keyword handling
- Logs each send for audit purposes

If you have any doubt about consent, **do not call this tool.**

## Configuration

| Env var             | Required | Default                                                              |
| ------------------- | -------- | -------------------------------------------------------------------- |
| `BUYER_PRIVATE_KEY` | yes      | —                                                                    |
| `SMS_URL`           | no       | `https://x402-sms-server-production.up.railway.app/send`             |

To point the MCP server at your own seller deployment, override `SMS_URL`.

## How it works

```
Claude Desktop ──tool call──> MCP server (this package, on your machine)
                              │
                              │ x402 payment (USDC, Base Sepolia)
                              │ + to/message/opt_in_attestation
                              ▼
                              Public seller (Hono + Twilio on Railway)
                              │
                              │ Twilio dispatch
                              ▼
                              SMS lands on recipient's phone
                              │
                              │ Twilio SID + status
                              ▼
                              MCP server ──tool result──> Claude Desktop
```

The MCP server doesn't talk to Twilio directly. It signs an x402 payment with the buyer's wallet, sends the payment + message details to the seller endpoint, and the seller's verified toll-free number dispatches the SMS. Your private key never leaves your machine. The seller never sees it.

## Roadmap

- **Now**: Testnet (Base Sepolia), TFV pending. Pay flow works, delivery blocked.
- **Days from now (TFV approval)**: Real US SMS delivery on testnet pricing.
- **A few weeks (A2P 10DLC Brand approval)**: Higher throughput tier.
- **Mainnet flip**: Production launch, USDC payments settle on Base mainnet.

## License

MIT
