import { whatsappClient } from '../whatsapp';
import { WAMessage } from '../types';

export interface GetMessagesInput {
  chatId: string;
  limit?: number;
}

export interface GetMessagesResult {
  messages: WAMessage[];
  total: number;
  chatId: string;
  message: string;
}

export function toolGetMessages(input: GetMessagesInput): GetMessagesResult {
  if (!input.chatId?.trim()) {
    return { messages: [], total: 0, chatId: '', message: 'chatId is required.' };
  }

  if (whatsappClient.getStatus() !== 'connected') {
    return { messages: [], total: 0, chatId: input.chatId, message: 'Not connected. Call whatsapp_connect first.' };
  }

  const limit = Math.min(input.limit ?? 20, 100);
  // Normalise chatId — accept plain phone number
  const chatId = input.chatId.includes('@') ? input.chatId : `${input.chatId}@s.whatsapp.net`;

  const messages = whatsappClient.getMessages(chatId, limit);
  return {
    messages,
    total: messages.length,
    chatId,
    message: messages.length > 0
      ? `Retrieved ${messages.length} message(s) from ${chatId}.`
      : `No messages found for ${chatId}. Messages arrive in real-time after connecting.`,
  };
}
