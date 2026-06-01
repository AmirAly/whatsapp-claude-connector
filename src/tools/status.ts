import { whatsappClient } from '../whatsapp';
import { StatusResult } from '../types';

export function toolStatus(): StatusResult {
  const status = whatsappClient.getStatus();
  const phone = whatsappClient.getPhoneNumber();

  const messages: Record<string, string> = {
    connected:    `Connected${phone ? ` as +${phone}` : ''} ✓`,
    connecting:   'Connecting to WhatsApp…',
    qr_ready:     'QR code ready — waiting for scan.',
    disconnected: 'Not connected. Call whatsapp_connect to start.',
  };

  return {
    status,
    phoneNumber: phone,
    message: messages[status] ?? 'Unknown status.',
  };
}
