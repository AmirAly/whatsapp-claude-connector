#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { toolConnect } from './tools/connect';
import { toolStatus } from './tools/status';
import { toolGetChats } from './tools/get_chats';
import { toolGetMessages } from './tools/get_messages';
import { toolSearchChat } from './tools/search_chat';
import { toolSendMessage } from './tools/send_message';
import { whatsappClient } from './whatsapp';

const server = new Server(
  { name: 'whatsapp-claude-connector', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'whatsapp_connect', description: 'Connect to WhatsApp. On first run returns a QR code. On subsequent runs restores the saved session.', inputSchema: { type: 'object', properties: {}, required: [] } },
    { name: 'whatsapp_status', description: 'Check if WhatsApp is connected and which phone number is active.', inputSchema: { type: 'object', properties: {}, required: [] } },
    { name: 'whatsapp_get_chats', description: 'List recent WhatsApp chats sorted by latest message.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max chats to return (default 20, max 100)' } }, required: [] } },
    { name: 'whatsapp_search_chat', description: 'Search for a chat by contact name, group name, or phone number.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Name or phone number to search for' } }, required: ['query'] } },
    { name: 'whatsapp_get_messages', description: 'Get messages from a specific WhatsApp chat.', inputSchema: { type: 'object', properties: { chatId: { type: 'string', description: 'Chat ID or plain phone number' }, limit: { type: 'number', description: 'Max messages to return (default 20, max 100)' } }, required: ['chatId'] } },
    { name: 'whatsapp_send_message', description: 'Send a plain text message to a WhatsApp contact or group.', inputSchema: { type: 'object', properties: { chatId: { type: 'string', description: 'Chat ID or plain phone number' }, text: { type: 'string', description: 'Message text to send' } }, required: ['chatId', 'text'] } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    let result: unknown;
    switch (name) {
      case 'whatsapp_connect': result = await toolConnect(); break;
      case 'whatsapp_status': result = toolStatus(); break;
      case 'whatsapp_get_chats': result = toolGetChats(args as { limit?: number }); break;
      case 'whatsapp_search_chat': result = toolSearchChat(args as { query: string }); break;
      case 'whatsapp_get_messages': result = toolGetMessages(args as { chatId: string; limit?: number }); break;
      case 'whatsapp_send_message': result = await toolSendMessage(args as { chatId: string; text: string }); break;
      default: return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err: unknown) {
    return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('WhatsApp Claude Connector running\n');
  const credsFile = path.join(os.homedir(), '.whatsapp-claude', 'session', 'creds.json');
  if (fs.existsSync(credsFile)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
      if (creds.registered) { whatsappClient.connect().catch((err: unknown) => { process.stderr.write(`Auto-connect failed: ${err}\n`); }); }
      else { fs.rmSync(path.join(os.homedir(), '.whatsapp-claude', 'session'), { recursive: true, force: true }); }
    } catch { /* ignore */ }
  }
}

main().catch((err) => { process.stderr.write(`Fatal: ${err}\n`); process.exit(1); });
