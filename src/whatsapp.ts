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

// ─── Session directory ────────────────────────────────────────────────────────
const SESSION_DIR = path.join(os.homedir(), '.whatsapp-claude', 'session');

// ─── WhatsAppClient ───────────────────────────────────────────────────────────
export class WhatsAppClient {
  private sock: WASocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private phoneNumber: string | undefined;

  // In-memory message store: chatId → WAMessage[]
  private messageStore: Map<string, WAMessage[]> = new Map();
  // In-memory chat store: chatId → WAChat
  private chatStore: Map<string, WAChat> = new Map();

  // Pending QR resolve — fulfilled once QR string is ready
  private qrResolve: ((qr: string) => void) | null = null;

  // ─── Public API ─────────────────────────────────────────────────────────────

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getPhoneNumber(): string | undefined {
    return this.phoneNumber;
  }

  /**
   * Connect to WhatsApp.
   * - If a saved session exists → reconnects silently, returns 'session_restored'
   * - If already connected → returns 'already_connected'
   * - Otherwise → emits QR, waits for scan, returns 'qr_ready' with ASCII QR
   */
  async connect(): Promise<ConnectResult> {
    if (this.status === 'connected') {
      return { status: 'already_connected', message: 'Already connected to WhatsApp.' };
    }

    this.status = 'connecting';

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: require('pino')({ level: 'silent' }),
      markOnlineOnConnect: false,
    });

    this._bindEvents(saveCreds);

    // Already have credentials → session will restore without QR
    if (state.creds.registered) {
      await this._waitForConnection();
      return { status: 'session_restored', message: 'Session restored. Connected to WhatsApp ✓' };
    }

    // Fresh login — wait for QR
    this.status = 'connecting';
    const qrData = await this._waitForQR();
    const qrAscii = await QRCode.toString(qrData, { type: 'terminal', small: true });

    return {
      status: 'qr_ready',
      qrCode: qrAscii,
      qrData,
      message: 'Scan the QR code with your WhatsApp app → Settings → Linked Devices → Link a Device',
    };
  }

  async disconnect(): Promise<void> {
    if (this.sock) {
      await this.sock.logout();
      this.sock = null;
    }
    this.status = 'disconnected';
    this.phoneNumber = undefined;
  }

  /**
   * Return recent chats sorted by last message time (newest first).
   */
  getChats(limit = 20): WAChat[] {
    const chats = Array.from(this.chatStore.values())
      .sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0))
      .slice(0, limit);
    return chats;
  }

  /**
   * Get messages from a specific chat.
   */
  getMessages(chatId: string, limit = 20): WAMessage[] {
    const msgs = this.messageStore.get(chatId) ?? [];
    return msgs.slice(-limit);
  }

  /**
   * Search chats by name, group name, or phone number.
   */
  searchChats(query: string): WAChat[] {
    const q = query.toLowerCase().replace(/[\s\-\+\(\)]/g, '');
    return Array.from(this.chatStore.values()).filter(chat => {
      const nameMatch = chat.name.toLowerCase().includes(q);
      // Strip formatting from ID for phone number search
      const idStripped = chat.id.replace(/[^0-9]/g, '');
      const phoneMatch = idStripped.includes(q);
      return nameMatch || phoneMatch;
    });
  }

  /**
   * Send a plain text message to a chat.
   */
  async sendMessage(chatId: string, text: string): Promise<SendResult> {
    if (!this.sock || this.status !== 'connected') {
      return { success: false, message: 'Not connected to WhatsApp. Call whatsapp_connect first.' };
    }
    try {
      // Normalise chat ID format
      const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
      const result = await this.sock.sendMessage(jid, { text });
      return {
        success: true,
        messageId: result?.key.id ?? undefined,
        message: `Message sent ✓`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Failed to send: ${msg}` };
    }
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  private _bindEvents(saveCreds: () => Promise<void>): void {
    if (!this.sock) return;

    // Credentials update
    this.sock.ev.on('creds.update', saveCreds);

    // QR code
    this.sock.ev.on('connection.update', (update) => {
      const { qr, connection, lastDisconnect } = update;

      if (qr && this.qrResolve) {
        this.status = 'qr_ready';
        this.qrResolve(qr);
        this.qrResolve = null;
      }

      if (connection === 'open') {
        this.status = 'connected';
        this.phoneNumber = this.sock?.user?.id?.split(':')[0];
      }

      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        this.status = 'disconnected';
        if (!loggedOut && this.sock) {
          // Auto-reconnect unless explicitly logged out
          this.connect().catch(() => {});
        }
      }
    });

    // Incoming messages
    this.sock.ev.on('messages.upsert', ({ messages }) => {
      for (const m of messages) {
        if (!m.message) continue;

        const chatId = m.key.remoteJid ?? '';
        const text =
          m.message.conversation ??
          m.message.extendedTextMessage?.text ??
          '[media]';

        const waMsg: WAMessage = {
          id: m.key.id ?? '',
          chatId,
          sender: m.key.participant ?? m.key.remoteJid ?? '',
          senderName: (m.pushName ?? m.key.participant ?? m.key.remoteJid ?? '').split('@')[0],
          text,
          timestamp: (m.messageTimestamp as number) ?? Math.floor(Date.now() / 1000),
          fromMe: m.key.fromMe ?? false,
        };

        // Store message
        if (!this.messageStore.has(chatId)) this.messageStore.set(chatId, []);
        this.messageStore.get(chatId)!.push(waMsg);

        // Keep last 200 messages per chat
        const msgs = this.messageStore.get(chatId)!;
        if (msgs.length > 200) msgs.splice(0, msgs.length - 200);

        // Update chat store
        this._upsertChat(chatId, text, waMsg.timestamp, m.key.fromMe ?? false);
      }
    });

    // Chat list
    this.sock.ev.on('chats.upsert', (chats) => {
      for (const chat of chats) {
        if (!this.chatStore.has(chat.id)) {
          this.chatStore.set(chat.id, {
            id: chat.id,
            name: (chat as { name?: string }).name ?? chat.id.split('@')[0],
            isGroup: chat.id.endsWith('@g.us'),
            unreadCount: chat.unreadCount ?? 0,
          });
        }
      }
    });

    // Contacts (for display names)
    this.sock.ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) {
        const existing = this.chatStore.get(contact.id);
        const name = contact.name ?? contact.notify ?? contact.id.split('@')[0];
        if (existing) {
          existing.name = name;
        } else {
          this.chatStore.set(contact.id, {
            id: contact.id,
            name,
            isGroup: contact.id.endsWith('@g.us'),
          });
        }
      }
    });
  }

  private _upsertChat(chatId: string, lastMessage: string, timestamp: number, fromMe: boolean): void {
    const existing = this.chatStore.get(chatId);
    if (existing) {
      existing.lastMessage = lastMessage;
      existing.lastMessageTime = timestamp;
      if (!fromMe) existing.unreadCount = (existing.unreadCount ?? 0) + 1;
    } else {
      this.chatStore.set(chatId, {
        id: chatId,
        name: chatId.split('@')[0],
        lastMessage,
        lastMessageTime: timestamp,
        unreadCount: fromMe ? 0 : 1,
        isGroup: chatId.endsWith('@g.us'),
      });
    }
  }

  private _waitForQR(): Promise<string> {
    return new Promise((resolve) => {
      this.qrResolve = resolve;
    });
  }

  private _waitForConnection(timeoutMs = 20000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.status === 'connected') return resolve();
      const check = setInterval(() => {
        if (this.status === 'connected') {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, 500);
      const timer = setTimeout(() => {
        clearInterval(check);
        reject(new Error('Connection timeout'));
      }, timeoutMs);
    });
  }

  // ─── Test helpers (exposed for unit tests) ───────────────────────────────────

  _setStatus(s: ConnectionStatus): void { this.status = s; }
  _setPhoneNumber(p: string): void { this.phoneNumber = p; }
  _injectChat(chat: WAChat): void { this.chatStore.set(chat.id, chat); }
  _injectMessage(msg: WAMessage): void {
    if (!this.messageStore.has(msg.chatId)) this.messageStore.set(msg.chatId, []);
    this.messageStore.get(msg.chatId)!.push(msg);
  }
  _clearStores(): void {
    this.chatStore.clear();
    this.messageStore.clear();
  }
}

// Singleton
export const whatsappClient = new WhatsAppClient();
