import { whatsappClient } from '../whatsapp';
import { ConnectResult } from '../types';

export async function toolConnect(): Promise<ConnectResult> {
  return whatsappClient.connect();
}
