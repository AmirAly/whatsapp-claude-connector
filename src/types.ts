export type ConnectionStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';

export interface WAChat {
  id: string;
  name: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount?: number;
  isGroup: boolean;
}

export interface WAMessage {
  id: string;
  chatId: string;
  sender: string;
  senderName: string;
  text: string;
  timestamp: number;
  fromMe: boolean;
}

export interface ConnectResult {
  status: 'qr_ready' | 'already_connected' | 'session_restored';
  qrCode?: string;   // ASCII QR for terminal display
  qrData?: string;   // raw QR string for rendering
  message: string;
}

export interface StatusResult {
  status: ConnectionStatus;
  phoneNumber?: string;
  message: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  message: string;
}
