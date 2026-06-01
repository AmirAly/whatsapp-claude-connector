import { whatsappClient } from '../whatsapp';
import { SendResult } from '../types';

export interface SendMessageInput {
  chatId: string;
  text: string;
}

export async function toolSendMessage(input: SendMessageInput): Promise<SendResult> {
  if (!input.chatId?.trim()) {
    return { success: false, message: 'chatId is required.' };
  }
  if (!input.text?.trim()) {
    return { success: false, message: 'text cannot be empty.' };
  }

  return whatsappClient.sendMessage(input.chatId.trim(), input.text.trim());
}
