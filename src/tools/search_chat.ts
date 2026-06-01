import { whatsappClient } from '../whatsapp';
import { WAChat } from '../types';

export interface SearchChatInput {
  query: string;
}

export interface SearchChatResult {
  chats: WAChat[];
  total: number;
  message: string;
}

export function toolSearchChat(input: SearchChatInput): SearchChatResult {
  if (!input.query?.trim()) {
    return { chats: [], total: 0, message: 'Query cannot be empty.' };
  }

  if (whatsappClient.getStatus() !== 'connected') {
    return { chats: [], total: 0, message: 'Not connected. Call whatsapp_connect first.' };
  }

  const chats = whatsappClient.searchChats(input.query.trim());
  return {
    chats,
    total: chats.length,
    message: chats.length > 0
      ? `Found ${chats.length} match(es) for "${input.query}".`
      : `No chats found matching "${input.query}".`,
  };
}
