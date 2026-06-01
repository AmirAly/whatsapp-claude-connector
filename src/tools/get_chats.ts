import { whatsappClient } from '../whatsapp';
import { WAChat } from '../types';

export interface GetChatsInput {
  limit?: number;
}

export interface GetChatsResult {
  chats: WAChat[];
  total: number;
  message: string;
}

export function toolGetChats(input: GetChatsInput = {}): GetChatsResult {
  const limit = Math.min(input.limit ?? 20, 100);

  if (whatsappClient.getStatus() !== 'connected') {
    return { chats: [], total: 0, message: 'Not connected. Call whatsapp_connect first.' };
  }

  const chats = whatsappClient.getChats(limit);
  return {
    chats,
    total: chats.length,
    message: chats.length > 0
      ? `Found ${chats.length} chat(s).`
      : 'No chats yet — try sending a message first.',
  };
}
