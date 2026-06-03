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
import * as fs from 'fs';
import { ConnectionStatus, WAChat, WAMessage, ConnectResult, StatusResult, SendResult } from './types';

const BASE_DIR     = path.join(os.homedir(), '.whatsapp-claude');
const SESSION_DIR  = path.join(BASE_DIR, 'session');
const STORE_FILE   = path.join(BASE_DIR, 'store.json');
const STORE_MAX_AGE_DAYS = 7;
const MAX_MESSAGES_PER_CHAT = 200;
const HISTORY_SYNC_TIMEOUT_MS = 30000;

interface StoreData {
  createdAt: string;
  chats: Record<string, WAChat>;
  messages: Record<string, WAMessage[]>;
}

export class WhatsAppClient {
  private sock: WASocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private phoneNumber: string | undefined;
  private messageStore: Map<string, WAMessage[]> = new Map();
  private chatStore: Map<string, WAChat> = new Map();
  private qrResolve: ((qr: string) => void) | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 3;

  getStatus(): ConnectionStatus { return this.status; }
  getPhoneNumber(): string | undefined { return this.phoneNumber; }

  loadStore(): void {
    try {
      if (!fs.existsSync(STORE_FILE)) return;
      const data: StoreData = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      const createdAt = new Date(data.createdAt);
      const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > STORE_MAX_AGE_DAYS) {
        const dateStr = createdAt.toISOString().split('T')[0];
        fs.renameSync(STORE_FILE, path.join(BASE_DIR, `store-${dateStr}.json`));
        process.stderr.write(`Store archived → store-${dateStr}.json\n`);
        return;
      }
      this.chatStore = new Map(Object.entries(data.chats ?? {}));
      this.messageStore = new Map(
        Object.entries(data.messages ?? {}).map(([k, v]) => [k, v as WAMessage[]])
      );
      process.stderr.write(`Store loaded: ${this.chatStore.size} chats\n`);
    } catch (err) { process.stderr.write(`loadStore error: ${err}\n`); }
  }

  private saveStore(): void {
    try {
      let createdAt = new Date().toISOString();
      if (fs.existsSync(STORE_FILE)) {
        try { const e = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); if (e.createdAt) createdAt = e.createdAt; } catch { /* use now */ }
      }
      fs.mkdirSync(BASE_DIR, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify({ createdAt, chats: Object.fromEntries(this.chatStore), messages: Object.fromEntries(this.messageStore) }), 'utf8');
    } catch (err) { process.stderr.write(`saveStore error: ${err}\n`); }
  }

  async connect(): Promise<ConnectResult> {
    if (this.status === 'connected') return { status: 'already_connected', message: 'Already connected to WhatsApp.' };
    this.status = 'connecting'; this.reconnectAttempts = 0;
    return this._doConnect();
  }

  private async _doConnect(): Promise<ConnectResult> {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
      const { version } = await Promise.race([fetchLatestBaileysVersion(), new Promise<{ version: [number, number, number] }>(r => setTimeout(() => r({ version: [2, 3000, 1023] }), 5000))]);
      this.sock = makeWASocket({ version, auth: state, printQRInTerminal: false, logger: require('pino')({ level: 'silent' }), markOnlineOnConnect: false });
      this._bindEvents(saveCreds);
      if (state.creds.registered) { await this._waitForConnection(); return { status: 'session_restored', message: 'Session restored ✓' }; }
      this.status = 'connecting';
      const qrData = await this._waitForQR();
      return { status: 'qr_ready', qrCode: await QRcode.toString(qrData, { type: 'terminal', small: true }), qrData, message: 'Scan the QR code' };
    } catch (err) { this.status = 'disconnected'; throw err; }
  }

  async disconnect(): Promise<void> {
    if (this.sock) { await this.sock.logout(); this.sock = null; }
    this.status = 'disconnected'; this.phoneNumber = undefined;
  }

  getChats(limit = 20): WAChat[] { return Array.from(this.chatStore.values()).sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0)).slice(0, limit); }
  getMessages(chatId: string, limit = 20): WAMessage[] { return (this.messageStore.get(chatId) ?? []).slice(-limit); }
  searchChats(query: string): WAChat[] { const q = query.toLowerCase().replace(/[\s\-\+\(\)]/g, ''); return Array.from(this.chatStore.values()).filter(c => c.name.toLowerCase().includes(q) || c.id.replace(/[^0-9]/g, '').includes(q)); }

  async sendMessage(chatId: string, text: string): Promise<SendResult> {
    if (!this.sock || this.status !== 'connected') return { success: false, message: 'Not connected. Call whatsapp_connect first.' };
    try {
      const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
      const result = await this.sock.sendMessage(jid, { text });
      return { success: true, messageId: result?.key.id ?? undefined, message: 'Message sent ✓' };
    } catch (err: unknown) { return { success: false, message: `Failed: ${err instanceof Error ? err.message : String(err)}` }; }
  }

  private _bindEvents(saveCreds: () => Promise<void>): void {
    if (!this.sock) return;
    this.sock.ev.on('creds.update', () => { saveCreds().catch(e => process.stderr.write(`saveCreds: ${e}\n`)); });
    this.sock.ev.on('connection.update', update => {
      try {
        const { qr, connection, lastDisconnect } = update;
        if (qr && this.qrResolve) { this.status = 'qr_ready'; this.qrResolve(qr); this.qrResolve = null; }
        if (connection === 'open') { this.status = 'connected'; this.phoneNumber = this.sock?.user?.id?.split(':')[0]; this.reconnectAttempts = 0; }
        if (connection === 'close') {
          const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
          this.status = 'disconnected';
          if (code !== DisconnectReason.loggedOut && this.sock && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => this._doConnect().catch(() => {}), 5000 * this.reconnectAttempts);
          }
        }
      } catch (err) { process.stderr.write(`connection.update error: ${err}\n`); }
    });
    const hT = setTimeout(() => process.stderr.write('History sync timeout (30s)\n'), HISTORY_SYNC_TIMEOUT_MS);
    this.sock.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
      clearTimeout(hT);
      try {
        const cutoff = Math.floor(Date.now() / 1000) - 86400;
        for (const m of messages) {
          try {
            if (!m.message) continue;
            const ts = (m.messageTimestamp as number) ?? 0;
            if (ts < cutoff) continue;
            const chatId = m.key.remoteJid ?? ''; if (!chatId) continue;
            const text = m.message.conversation ?? m.message.extendedTextMessage?.text ?? '[media]';
            const w = { id: m.key.id ?? '', chatId, sender: m.key.participant ?? m.key.remoteJid ?? '', senderName: (m.pushName ?? m.key.participant ?? m.key.remoteJid ?? '').split('@')[0], text, timestamp: ts, fromMe: m.key.fromMe ?? false };
            if (!this.messageStore.has(chatId)) this.messageStore.set(chatId, []);
            const a = this.messageStore.get(chatId)!;
            if (!a.find(x => x.id === w.id)) a.push(w);
            if (a.length > MAX_MESSAGES_PER_CHAT) a.splice(0, a.length - MAX_MESSAGES_PER_CHAT);
            this._upsertChat(chatId, text, ts, m.key.fromMe ?? false);
          } catch { /* skip */ }
        }
        for (const c of chats) { try { if (!this.chatStore.has(c.id)) this.chatStore.set(c.id, { id: c.id, name: (c as any).name ?? c.id.split('@')[0], isGroup: c.id.endsWith('@g.us'), unreadCount: c.unreadCount ?? 0 }); } catch { /* skip */ } }
        for (const c of contacts) { try { const n = c.name ?? c.notify ?? c.id.split('@')[0]; const e = this.chatStore.get(c.id); if (e) e.name = n; } catch { /* skip */ } }
        this.saveStore();
        process.stderr.write(`History sync: ${messages.length} msgs, ${chats.length} chats\n`);
      } catch (err) { process.stderr.write(`history.set error: ${err}\n`); }
    });
    this.sock.ev.on('messages.upsert', ({ messages }) => {
      try { for (const m of messages) { try { if (!m.message) continue; const chatId = m.key.remoteJid ?? ''; if (!chatId) continue; const text = m.message.conversation ?? m.message.extendedTextMessage?.text ?? '[media]'; const w = { id: m.key.id ?? '', chatId, sender: m.key.participant ?? m.key.remoteJid ?? '', senderName: (m.pushName ?? m.key.participant ?? m.key.remoteJid ?? '').split('@')[0], text, timestamp: (m.messageTimestamp as number) ?? Math.floor(Date.now() / 1000), fromMe: m.key.fromMe ?? false }; if (!this.messageStore.has(chatId)) this.messageStore.set(chatId, []); const a = this.messageStore.get(chatId)!; a.push(w); if (a.length > MAX_MESSAGES_PER_CHAT) a.splice(0, a.length - MAX_MESSAGES_PER_CHAT); this._upsertChat(chatId, text, w.timestamp, m.key.fromMe ?? false); } catch { /* skip */ } } this.saveStore(); } catch (err) { process.stderr.write(`msgs.upsert error: ${err}\n`); }
    });
    this.sock.ev.on('chats.upsert', cs => { try { for (const c of cs) { try { if (!this.chatStore.has(c.id)) this.chatStore.set(c.id, { id: c.id, name: (c as any).name ?? c.id.split('@')[0], isGroup: c.id.endsWith('@g.us'), unreadCount: c.unreadCount ?? 0 }); } catch { /* skip */ } } this.saveStore(); } catch (err) { process.stderr.write(`chats.upsert error: ${err}\n`); } });
    this.sock.ev.on('contacts.upsert', cs => { try { for (const c of cs) { try { const n = c.name ?? c.notify ?? c.id.split('@')[0]; const e = this.chatStore.get(c.id); if (e) { e.name = n; } else { this.chatStore.set(c.id, { id: c.id, name: n, isGroup: c.id.endsWith('@g.us') }); } } catch { /* skip */ } } this.saveStore(); } catch (err) { process.stderr.write(`contacts.upsert error: ${err}\n`); } });
  }

  private _upsertChat(chatId: string, lt: string, ts: number, fm: boolean): void {
    const e = this.chatStore.get(chatId);
    if (e) { e.lastMessage = lt; e.lastMessageTime = ts; if (!fm) e.unreadCount = (e.unreadCount ?? 0) + 1;
    } else { this.chatStore.set(chatId, { id: chatId, name: chatId.split('@')[0], lastMessage: lt, lastMessageTime: ts, unreadCount: fm ? 0 : 1, isGroup: chatId.endsWith('@g.us') }); }
  }
  private _waitForQR(t = 60000): Promise<string> { return new Promise((r, rj) => { this.qrResolve = r; setTimeout(() => { this.qrResolve = null; rj(); }, t); }); }
  private _waitForConnection(t = 20000): Promise<void> { return new Promise((r, rj) => { if (this.status === 'connected') return r(); const c = setInterval(() => { if (this.status === 'connected') { clearInterval(c); clearTimeout(tm); r(); } }, 500); const tm = setTimeout(() => { clearInterval(c); rj(); }, t); }); }

  _setStatus(s: ConnectionStatus): void { this.status = s; }
  _setPhoneNumber(p: string): void { this.phoneNumber = p; }
  _injectChat(c: WAChat): void { this.chatStore.set(c.id, c); }
  _injectMessage(m: WAMessage): void { if (!this.messageStore.has(m.chatId)) this.messageStore.set(m.chatId, []); this.messageStore.get(m.chatId)!.push(m); }
  _clearStores(): void { this.chatStore.clear(); this.messageStore.clear(); }
}

export const whatsappClient = new WhatsAppClient();
