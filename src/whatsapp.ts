import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import * as path from 'path';
import * as os from 'os';
import { ConnectionStatus, WAChat, WAMessage, ConnectResult, StatusResult, SendResult } from './types';

const SESSION_DIR = path.join(os.homedir(), '.whatsapp-claude', 'session');

export class WhatsAppClient {
  private sock: WASocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private phoneNumber: string | undefined;
  private messageStore: Map<string, WAMessage[]> = new Map();
  private chatStore: Map<string, WAChat> = new Map();
  private qrResolve: ((qr: string) => void) | null = null;

  getStatus(): ConnectionStatus { return this.status; }
  getPhoneNumber(): string | undefined { return this.phoneNumber; }

  async connect(): Promise<ConnectResult> {
    if (this.status === 'connected') return { status: 'already_connected', message: 'Already connected to WhatsApp.' };
    this.status = 'connecting';
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise<{ version: [number, number, number] }>(resolve => setTimeout(() => resolve({ version: [2, 3000, 1023] }), 5000)),
    ]);
    this.sock = makeWASocket({ version, auth: state, printQRInTerminal: false, logger: require('pino')({ level: 'silent' }), markOnlineOnConnect: false });
    this._bindEvents(saveCreds);
    if (state.creds.registered) {
      await this._waitForConnection();
      return { status: 'session_restored', message: 'Session restored. Connected to WhatsApp ✓' };
    }
    this.status = 'connecting';
    const qrData = await this._waitForQR();
    const qrAscii = await QRcode.toString(qrData, { type: 'terminal', small: true });
    return { status: 'qr_ready', qrCode: qrAscii, qrData, message: 'Scan the QR code with your WhatsApp app' };
  }

  async disconnect(): Promise<void> {
    if (this.sock) { await this.sock.logout(); this.sock = null; }
    this.status = 'disconnected'; this.phoneNumber = undefined;
  }

  getChats(limit = 20): WAChat[] {
    return Array.from(this.chatStore.values()).sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0)).slice(0, limit);
  }

  getMessages(chatId: string, limit = 20): WAMessage[] {
    return (this.messageStore.get(chatId) ?? []).slice(-limit);
  }

  searchChats(query: string): WAChat[] {
    const q = query.toLowerCase().replace(/[\s\-\+\(\)]/g, '');
    return Array.from(this.chatStore.values()).filter(chat => {
      return chat.name.toLowerCase().includes(q) || chat.id.replace(/[^0-9]/g, '').includes(q);
    });
  }

  async sendMessage(chatId: string, text: string): Promise<SendResult> {
    if (!this.sock || this.status !== 'connected') return { success: false, message: 'Not connected to WhatsApp.' };
    try {
      const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
      const result = await this.sock.sendMessage(jid, { text });
      return { success: true, messageId: result?.key.id ?? undefined, message: 'Message sent ✓' };
    } catch (err: unknown) {
      return { success: false, message: `Failed to send: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private _bindEvents(saveCreds: () => Promise<void>): void {
    if (!this.sock) return;
    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('connection.update', (update) => {
      const { qr, connection, lastDisconnect } = update;
      if (qr && this.qrResolve) { this.status = 'qr_ready'; this.qrResolve(qr); this.qrResolve = null; }
      if (connection === 'open') { this.status = 'connected'; this.phoneNumber = this.sock?.user?.id?.split(':')[0]; }
      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
        this.status = 'disconnected';
        if (code !== DisconnectReason.loggedOut && this.sock) this.connect().catch(() => {});
      }
    });
    this.sock.ev.on('messages.upsert', ({ messages }) => {
      for (const m of messages) {
        if (!m.message) continue;
        const chatId = m.key.remoteJid ?? '';
        const text = m.message.conversation ?? m.message.extendedTextMessage?.text ?? '[media]';
        const waMsg: WAMessage = { id: m.key.id ?? '', chatId, sender: m.key.participant ?? m.key.remoteJid ?? '', senderName: (m.pushName ?? m.key.participant ?? m.key.remoteJid ?? '').split('@')[0], text, timestamp: (m.messageTimestamp as number) ?? Math.floor(Date.now() / 1000), fromMe: m.key.fromMe ?? false };
        if (!this.messageStore.has(chatId)) this.messageStore.set(chatId, []);
        const msgs = this.messageStore.get(chatId)!;
        msgs.push(waMsg);
        if (msgs.length > 200) msgs.splice(0, msgs.length - 200);
        this._upsertChat(chatId, text, waMsg.timestamp, m.key.fromMe ?? false);
      }
    });
    this.sock.ev.on('chats.upsert', (chats) => {
      for (const chat of chats) {
        if (!this.chatStore.has(chat.id)) this.chatStore.set(chat.id, { id: chat.id, name: (chat as { name?: string }).name ?? chat.id.split('@')[0], isGroup: chat.id.endsWith('@g.us'), unreadCount: chat.unreadCount ?? 0 });
      }
    });
    this.sock.ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) {
        const name = contact.name ?? contact.notify ?? contact.id.split('@')[0];
        const existing = this.chatStore.get(contact.id);
        if (existing) { existing.name = name; } else { this.chatStore.set(contact.id, { id: contact.id, name, isGroup: contact.id.endsWith('@g.us') }); }
      }
    });
  }

  private _upsertChat(chatId: string, lastMessage: string, timestamp: number, fromMe: boolean): void {
    const existing = this.chatStore.get(chatId);
    if (existing) { existing.lastMessage = lastMessage; existing.lastMessageTime = timestamp; if (!fromMe) existing.unreadCount = (existing.unreadCount ?? 0) + 1;
    } else { this.chatStore.set(chatId, { id: chatId, name: chatId.split('@')[0], lastMessage, lastMessageTime: timestamp, unreadCount: fromMe ? 0 : 1, isGroup: chatId.endsWith('@g.us') }); }
  }

  private _waitForQR(timeoutMs = 60000): Promise<string> {
    return new Promise((resolve, reject) => {
      this.qrResolve = resolve;
      setTimeout(() => { this.qrResolve = null; reject(new Error('QR code generation timed out')); }, timeoutMs);
    });
  }

  private _waitForConnection(timeoutMs = 20000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.status === 'connected') return resolve();
      const check = setInterval(() => { if (this.status === 'connected') { clearInterval(check); clearTimeout(timer); resolve(); } }, 500);
      const timer = setTimeout(() => { clearInterval(check); reject(new Error('Connection timeout')); }, timeoutMs);
    });
  }

  _setStatus(s: ConnectionStatus): void { this.status = s; }
  _setPhoneNumber(p: string): void { this.phoneNumber = p; }
  _injectChat(chat: WAChat): void { this.chatStore.set(chat.id, chat); }
  _injectMessage(msg: WAMessage): void {
    if (!this.messageStore.has(msg.chatId)) this.messageStore.set(msg.chatId, []);
    this.messageStore.get(msg.chatId)!.push(msg);
  }
  _clearStores(): void { this.chatStore.clear(); this.messageStore.clear(); }
}

export const whatsappClient = new WhatsAppClient();
