# whatsapp-claude-connector

A local MCP (Model Context Protocol) server that connects Claude to your personal WhatsApp account. Scan a QR code once, then read chats, get messages, and send replies — all from within Claude.

## How it works

- Runs locally on your machine during your Claude session
- Uses [Baileys](https://github.com/WhiskeySockets/Baileys) — a pure WebSocket WhatsApp Web client (no browser, no Puppeteer)
- Session is saved to `~/.whatsapp-claude/session/` so you only scan the QR code once
- Works on macOS and Windows

## Requirements

- Node.js 18+
- Claude Desktop app

## Installation

```bash
npx whatsapp-claude-connector
```

Or install globally:

```bash
npm install -g whatsapp-claude-connector
```

## Claude Desktop configuration

Add this to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "npx",
      "args": ["whatsapp-claude-connector"]
    }
  }
}
```

Restart Claude Desktop after saving.

## First-time setup

1. In Claude, call the `whatsapp_connect` tool
2. Claude will display a QR code in ASCII art
3. Open WhatsApp on your phone → Settings → Linked Devices → Link a Device
4. Scan the QR code
5. You're connected — session is saved for future use

## Available tools

| Tool | Description |
|------|-------------|
| `whatsapp_connect` | Connect to WhatsApp (QR on first run, auto-restore after) |
| `whatsapp_status` | Check connection status and active phone number |
| `whatsapp_get_chats` | List recent chats sorted by latest message |
| `whatsapp_search_chat` | Search chats by name, group name, or phone number |
| `whatsapp_get_messages` | Get messages from a specific chat |
| `whatsapp_send_message` | Send a plain text message to a contact or group |

## Example prompts

```
Connect me to WhatsApp
```
```
Show me my 10 most recent chats
```
```
Search for Ahmed in my contacts
```
```
Summarize the last 20 messages from the Family Group chat
```
```
Send "On my way!" to +201012345678
```

## Notes

- The connection is active only while the MCP server process is running
- Messages are stored in-memory; historical messages load as they arrive after connecting
- Group messages and individual chats are both supported
- Only plain text messages can be sent (no media)

## Development

```bash
git clone https://github.com/AmirAly/whatsapp-claude-connector
cd whatsapp-claude-connector
npm install
npm test
npm run build
```

## License

MIT
