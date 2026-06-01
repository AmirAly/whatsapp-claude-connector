/**
 * Unit tests for WhatsAppClient
 * All Baileys network calls are mocked — no real WhatsApp connection needed.
 */

// ─── Mock Baileys before any imports ─────────────────────────────────────────
jest.mock('@whiskeysockets/baileys', () => {
  const mockSock = {
    ev: {
      on: jest.fn(),
    },
    logout: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue({ key: { id: 'mock-msg-id-123' } }),
    user: { id: '201012345678:0@s.whatsapp.net' },
  };

  const mockModule = jest.fn(() => mockSock);
  // Named exports
  (mockModule as unknown as Record<string, unknown>).useMultiFileAuthState = jest.fn().mockResolvedValue({
    state: { creds: { registered: true }, keys: {} },
    saveCreds: jest.fn(),
  });
  (mockModule as unknown as Record<string, unknown>).fetchLatestBaileysVersion = jest.fn().mockResolvedValue({ version: [2, 3000, 0] });
  (mockModule as unknown as Record<string, unknown>).makeInMemoryStore = jest.fn(() => ({ bind: jest.fn() }));
  (mockModule as unknown as Record<string, unknown>).DisconnectReason = { loggedOut: 401 };

  return {
    __esModule: true,
    default: mockModule,
    useMultiFileAuthState: jest.fn().mockResolvedValue({
      state: { creds: { registered: true }, keys: {} },
      saveCreds: jest.fn(),
    }),
    fetchLatestBaileysVersion: jest.fn().mockResolvedValue({ version: [2, 3000, 0] }),
    DisconnectReason: { loggedOut: 401 },
  };
});

jest.mock('qrcode', () => ({
  toString: jest.fn().mockResolvedValue('█▀▀▀█ mock-qr-ascii █▀▀▀█'),
}));

jest.mock('pino', () => jest.fn(() => ({ level: 'silent', info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn(() => ({ level: 'silent', info: jest.fn(), warn: jest.fn() })) })));

// ─── Now import the module under test ────────────────────────────────────────
import { WhatsAppClient } from '../src/whatsapp';
import { WAChat, WAMessage } from '../src/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeChat(overrides: Partial<WAChat> = {}): WAChat {
  return {
    id: '201012345678@s.whatsapp.net',
    name: 'Ahmed',
    isGroup: false,
    unreadCount: 0,
    lastMessage: 'Hey there',
    lastMessageTime: 1700000000,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<WAMessage> = {}): WAMessage {
  return {
    id: 'msg-001',
    chatId: '201012345678@s.whatsapp.net',
    sender: '201012345678@s.whatsapp.net',
    senderName: 'Ahmed',
    text: 'Hello World',
    timestamp: 1700000000,
    fromMe: false,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WhatsAppClient', () => {
  let client: WhatsAppClient;

  beforeEach(() => {
    client = new WhatsAppClient();
    client._clearStores();
  });

  // ── Status ──────────────────────────────────────────────────────────────────

  describe('getStatus()', () => {
    it('starts as disconnected', () => {
      expect(client.getStatus()).toBe('disconnected');
    });

    it('reflects injected status', () => {
      client._setStatus('connected');
      expect(client.getStatus()).toBe('connected');
    });
  });

  // ── getChats() ───────────────────────────────────────────────────────────────

  describe('getChats()', () => {
    it('returns empty array when no chats', () => {
      expect(client.getChats()).toEqual([]);
    });

    it('returns injected chats', () => {
      client._injectChat(makeChat({ name: 'Ahmed' }));
      client._injectChat(makeChat({ id: '201099999999@s.whatsapp.net', name: 'Sara' }));
      expect(client.getChats()).toHaveLength(2);
    });

    it('sorts by lastMessageTime descending', () => {
      client._injectChat(makeChat({ id: 'a@s.whatsapp.net', name: 'Old', lastMessageTime: 1000 }));
      client._injectChat(makeChat({ id: 'b@s.whatsapp.net', name: 'New', lastMessageTime: 9999 }));
      const chats = client.getChats();
      expect(chats[0].name).toBe('New');
      expect(chats[1].name).toBe('Old');
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 30; i++) {
        client._injectChat(makeChat({ id: `${i}@s.whatsapp.net`, name: `Chat ${i}` }));
      }
      expect(client.getChats(10)).toHaveLength(10);
      expect(client.getChats(30)).toHaveLength(30);
    });

    it('distinguishes groups from individual chats', () => {
      client._injectChat(makeChat({ id: '123456@g.us', name: 'Family Group', isGroup: true }));
      client._injectChat(makeChat({ id: '201012345678@s.whatsapp.net', name: 'Ahmed', isGroup: false }));
      const chats = client.getChats();
      const group = chats.find(c => c.isGroup);
      const individual = chats.find(c => !c.isGroup);
      expect(group?.name).toBe('Family Group');
      expect(individual?.name).toBe('Ahmed');
    });
  });

  // ── getMessages() ────────────────────────────────────────────────────────────

  describe('getMessages()', () => {
    it('returns empty array for unknown chat', () => {
      expect(client.getMessages('unknown@s.whatsapp.net')).toEqual([]);
    });

    it('returns messages for a known chat', () => {
      const msg = makeMessage();
      client._injectMessage(msg);
      const result = client.getMessages(msg.chatId);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Hello World');
    });

    it('returns last N messages when limit is applied', () => {
      const chatId = '201012345678@s.whatsapp.net';
      for (let i = 0; i < 50; i++) {
        client._injectMessage(makeMessage({ id: `msg-${i}`, chatId, text: `Message ${i}` }));
      }
      const result = client.getMessages(chatId, 10);
      expect(result).toHaveLength(10);
      // Should be the last 10
      expect(result[9].text).toBe('Message 49');
    });

    it('preserves message order (oldest first)', () => {
      const chatId = '201012345678@s.whatsapp.net';
      client._injectMessage(makeMessage({ id: 'a', chatId, text: 'First', timestamp: 1000 }));
      client._injectMessage(makeMessage({ id: 'b', chatId, text: 'Second', timestamp: 2000 }));
      const msgs = client.getMessages(chatId);
      expect(msgs[0].text).toBe('First');
      expect(msgs[1].text).toBe('Second');
    });

    it('correctly identifies fromMe messages', () => {
      const chatId = '201012345678@s.whatsapp.net';
      client._injectMessage(makeMessage({ id: 'mine', chatId, fromMe: true, text: 'My reply' }));
      client._injectMessage(makeMessage({ id: 'theirs', chatId, fromMe: false, text: 'Their msg' }));
      const msgs = client.getMessages(chatId);
      expect(msgs.find(m => m.fromMe)?.text).toBe('My reply');
      expect(msgs.find(m => !m.fromMe)?.text).toBe('Their msg');
    });
  });

  // ── searchChats() ────────────────────────────────────────────────────────────

  describe('searchChats()', () => {
    beforeEach(() => {
      client._injectChat(makeChat({ id: '201012345678@s.whatsapp.net', name: 'Ahmed Ali' }));
      client._injectChat(makeChat({ id: '201099887766@s.whatsapp.net', name: 'Sara Mohamed' }));
      client._injectChat(makeChat({ id: '123456789@g.us', name: 'Family Group', isGroup: true }));
    });

    it('finds chat by partial name (case-insensitive)', () => {
      expect(client.searchChats('ahmed')).toHaveLength(1);
      expect(client.searchChats('AHMED')).toHaveLength(1);
      expect(client.searchChats('ali')).toHaveLength(1);
    });

    it('finds chat by phone number', () => {
      expect(client.searchChats('201012345678')).toHaveLength(1);
      expect(client.searchChats('01012345678')).toHaveLength(1); // partial match
    });

    it('finds group by name', () => {
      const result = client.searchChats('family');
      expect(result).toHaveLength(1);
      expect(result[0].isGroup).toBe(true);
    });

    it('returns empty array for no match', () => {
      expect(client.searchChats('Nonexistent Person')).toHaveLength(0);
    });

    it('returns multiple matches when query is broad', () => {
      // Both Ahmed and Sara are in the store — search by @s.whatsapp.net domain part
      client._injectChat(makeChat({ id: '201011112222@s.whatsapp.net', name: 'Ahmed Junior' }));
      const result = client.searchChats('ahmed');
      expect(result).toHaveLength(2);
    });
  });

  // ── sendMessage() ────────────────────────────────────────────────────────────

  describe('sendMessage()', () => {
    it('returns error when not connected', async () => {
      client._setStatus('disconnected');
      const result = await client.sendMessage('201012345678@s.whatsapp.net', 'Hello');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Not connected');
    });

    it('normalises phone number to JID format', async () => {
      client._setStatus('connected');
      // Mock sock on connected client
      (client as unknown as { sock: { sendMessage: jest.Mock } }).sock = {
        sendMessage: jest.fn().mockResolvedValue({ key: { id: 'msg-abc' } }),
      };
      const result = await client.sendMessage('201012345678', 'Hi without @');
      expect(result.success).toBe(true);
      expect(
        (client as unknown as { sock: { sendMessage: jest.Mock } }).sock.sendMessage
      ).toHaveBeenCalledWith(
        '201012345678@s.whatsapp.net',
        { text: 'Hi without @' }
      );
    });

    it('returns success with messageId when socket succeeds', async () => {
      client._setStatus('connected');
      (client as unknown as { sock: { sendMessage: jest.Mock } }).sock = {
        sendMessage: jest.fn().mockResolvedValue({ key: { id: 'msg-xyz-789' } }),
      };
      const result = await client.sendMessage('201012345678@s.whatsapp.net', 'Hello!');
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-xyz-789');
    });

    it('returns failure when socket throws', async () => {
      client._setStatus('connected');
      (client as unknown as { sock: { sendMessage: jest.Mock } }).sock = {
        sendMessage: jest.fn().mockRejectedValue(new Error('Network error')),
      };
      const result = await client.sendMessage('201012345678@s.whatsapp.net', 'Hello');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Network error');
    });
  });

  // ── connect() — session restored path ───────────────────────────────────────

  describe('connect()', () => {
    it('returns already_connected when status is connected', async () => {
      client._setStatus('connected');
      const result = await client.connect();
      expect(result.status).toBe('already_connected');
      expect(result.message).toContain('Already connected');
    });
  });
});
