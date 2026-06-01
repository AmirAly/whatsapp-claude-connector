/**
 * Unit tests for all MCP tools.
 * The WhatsApp client is fully mocked — no real connection needed.
 */

// ─── Mock the WhatsApp client singleton ──────────────────────────────────────
const mockClient = {
  getStatus: jest.fn(),
  getPhoneNumber: jest.fn(),
  getChats: jest.fn(),
  getMessages: jest.fn(),
  searchChats: jest.fn(),
  sendMessage: jest.fn(),
  connect: jest.fn(),
};

jest.mock('../../src/whatsapp', () => ({
  whatsappClient: mockClient,
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────
import { toolStatus } from '../../src/tools/status';
import { toolGetChats } from '../../src/tools/get_chats';
import { toolGetMessages } from '../../src/tools/get_messages';
import { toolSearchChat } from '../../src/tools/search_chat';
import { toolSendMessage } from '../../src/tools/send_message';
import { WAChat, WAMessage } from '../../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chat(overrides: Partial<WAChat> = {}): WAChat {
  return {
    id: '201012345678@s.whatsapp.net',
    name: 'Ahmed',
    isGroup: false,
    unreadCount: 0,
    lastMessage: 'Hey',
    lastMessageTime: 1700000000,
    ...overrides,
  };
}

function msg(overrides: Partial<WAMessage> = {}): WAMessage {
  return {
    id: 'msg-001',
    chatId: '201012345678@s.whatsapp.net',
    sender: '201012345678@s.whatsapp.net',
    senderName: 'Ahmed',
    text: 'Hello',
    timestamp: 1700000000,
    fromMe: false,
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

// ─── toolStatus ───────────────────────────────────────────────────────────────

describe('toolStatus()', () => {
  it('reports disconnected state', () => {
    mockClient.getStatus.mockReturnValue('disconnected');
    mockClient.getPhoneNumber.mockReturnValue(undefined);
    const r = toolStatus();
    expect(r.status).toBe('disconnected');
    expect(r.message).toContain('Not connected');
  });

  it('reports connected state with phone number', () => {
    mockClient.getStatus.mockReturnValue('connected');
    mockClient.getPhoneNumber.mockReturnValue('201012345678');
    const r = toolStatus();
    expect(r.status).toBe('connected');
    expect(r.phoneNumber).toBe('201012345678');
    expect(r.message).toContain('+201012345678');
  });

  it('reports qr_ready state', () => {
    mockClient.getStatus.mockReturnValue('qr_ready');
    mockClient.getPhoneNumber.mockReturnValue(undefined);
    const r = toolStatus();
    expect(r.status).toBe('qr_ready');
    expect(r.message).toContain('QR');
  });

  it('reports connecting state', () => {
    mockClient.getStatus.mockReturnValue('connecting');
    mockClient.getPhoneNumber.mockReturnValue(undefined);
    const r = toolStatus();
    expect(r.status).toBe('connecting');
    expect(r.message).toContain('Connecting');
  });
});

// ─── toolGetChats ─────────────────────────────────────────────────────────────

describe('toolGetChats()', () => {
  it('returns not-connected message when disconnected', () => {
    mockClient.getStatus.mockReturnValue('disconnected');
    const r = toolGetChats();
    expect(r.chats).toHaveLength(0);
    expect(r.message).toContain('Not connected');
  });

  it('returns chats when connected', () => {
    mockClient.getStatus.mockReturnValue('connected');
    mockClient.getChats.mockReturnValue([chat({ name: 'Ahmed' }), chat({ id: '99@s.whatsapp.net', name: 'Sara' })]);
    const r = toolGetChats();
    expect(r.total).toBe(2);
    expect(r.chats[0].name).toBe('Ahmed');
  });

  it('passes limit to client (capped at 100)', () => {
    mockClient.getStatus.mockReturnValue('connected');
    mockClient.getChats.mockReturnValue([]);
    toolGetChats({ limit: 200 });
    expect(mockClient.getChats).toHaveBeenCalledWith(100);
  });

  it('uses default limit of 20', () => {
    mockClient.getStatus.mockReturnValue('connected');
    mockClient.getChats.mockReturnValue([]);
    toolGetChats();
    expect(mockClient.getChats).toHaveBeenCalledWith(20);
  });

  it('returns friendly message when no chats', () => {
    mockClient.getStatus.mockReturnValue('connected');
    mockClient.getChats.mockReturnValue([]);
    const r = toolGetChats();
    expect(r.message).toContain('No chats yet');
  });
});

// ─── toolSearchChat ───────────────────────────────────────────────────────────

describe('toolSearchChat()', () => {
  it('returns error for empty query', () => {
    const r = toolSearchChat({ query: '  ' });
    expect(r.total).toBe(0);
    expect(r.message).toContain('empty');
  });

  it('returns not-connected message when disconnected', () => {
    mockClient.getStatus.mockReturnValue('disconnected');
    const r = toolSearchChat({ query: 'Ahmed' });
    expect(r.message).toContain('Not connected');
  });

  it('returns matches when found', () => {
    mockClient.getStatus.mockReturnValue('connected');
    mockClient.searchChats.mockReturnValue([chat({ name: 'Ahmed Ali' })]);
    const r = toolSearchChat({ query: 'ahmed' });
    expect(r.total).toBe(1);
    expect(r.chats[0].name).toBe('Ahmed Ali');
    expect(r.message).toContain('ahmed');
  });

  it('returns no-match message when empty', () => {
    mockClient.getStatus.mockReturnValue('connected');
    mockClient.searchChats.mockReturnValue([]);
    const r = toolSearchChat({ query: 'Unknown' });
    expect(r.total).toBe(0);
    expect(r.message).toContain('No chats found');
  });

  it('trims whitespace from query before searching', () => {
    mockClient.getStatus.mockReturnValue('connected');
    mockClient.searchChats.mockReturnValue([]);
    toolSearchChat({ query: '  Ahmed  ' });
    expect(mockClient.searchChats).toHaveBeenCalledWith('Ahmed');
  });
});

// ─── toolGetMessages ──────────────────────────────────────────────────────────

describe('toolGetMessages()', () => {
  it('returns error for missing chatId', () => {
    const r = toolGetMessages({ chatId: '' });
    expect(r.messages).toHaveLength(0);
    expect(r.message).toContain('required');
  });

  it('returns not-connected message when disconnected', () => {
    mockClient.getStatus.mockReturnValue('disconnected');
    const r = toolGetMessages({ chatId: '201012345678' });
    expect(r.message).toContain('Not connected');
  });

  it('normalises plain phone number to JID', () => {
    mockClient.getStatus.mockReturnValue('connected');
    mockClient.getMessages.mockReturnValue([]);
    toolGetMessages({ chatId: '201012345678' });
    expect(mockClient.getMessages).toHaveBeenCalledWith('201012345678@s.whatsapp.net', 20);
  });

  it('passes through already-formatted JID unchanged', () => {
    mockClient.getStatus.mockReturnValue('connected');
    mockClient.getMessages.mockReturnValue([]);
    toolGetMessages({ chatId: '201012345678@s.whatsapp.net' });
    expect(mockClient.getMessages).toHaveBeenCalledWith('201012345678@s.whatsapp.net', 20);
  });

  it('returns messages when found', () => {
    mockClient.getStatus.mockReturnValue('connected');
    mockClient.getMessages.mockReturnValue([msg(), msg({ id: 'msg-002', text: 'World' })]);
    const r = toolGetMessages({ chatId: '201012345678@s.whatsapp.net', limit: 5 });
    expect(r.total).toBe(2);
    expect(r.messages[1].text).toBe('World');
  });

  it('caps limit at 100', () => {
    mockClient.getStatus.mockReturnValue('connected');
    mockClient.getMessages.mockReturnValue([]);
    toolGetMessages({ chatId: '201012345678@s.whatsapp.net', limit: 500 });
    expect(mockClient.getMessages).toHaveBeenCalledWith(expect.any(String), 100);
  });
});

// ─── toolSendMessage ──────────────────────────────────────────────────────────

describe('toolSendMessage()', () => {
  it('returns error for missing chatId', async () => {
    const r = await toolSendMessage({ chatId: '', text: 'Hi' });
    expect(r.success).toBe(false);
    expect(r.message).toContain('chatId');
  });

  it('returns error for empty text', async () => {
    const r = await toolSendMessage({ chatId: '201012345678', text: '   ' });
    expect(r.success).toBe(false);
    expect(r.message).toContain('empty');
  });

  it('delegates to whatsappClient.sendMessage with trimmed inputs', async () => {
    mockClient.sendMessage.mockResolvedValue({ success: true, messageId: 'abc', message: 'Message sent ✓' });
    const r = await toolSendMessage({ chatId: '  201012345678  ', text: '  Hello!  ' });
    expect(mockClient.sendMessage).toHaveBeenCalledWith('201012345678', 'Hello!');
    expect(r.success).toBe(true);
    expect(r.messageId).toBe('abc');
  });

  it('propagates failure from client', async () => {
    mockClient.sendMessage.mockResolvedValue({ success: false, message: 'Not connected to WhatsApp.' });
    const r = await toolSendMessage({ chatId: '201012345678', text: 'Hi' });
    expect(r.success).toBe(false);
    expect(r.message).toContain('Not connected');
  });
});
