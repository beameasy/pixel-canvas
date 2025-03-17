export async function verifyAlchemySignature(request: Request, signature?: string | null): Promise<boolean> {
  if (!signature || !process.env.ALCHEMY_WEBHOOK_SECRET) {
    console.warn('Missing signature or webhook secret');
    return false;
  }

  try {
    const body = await request.clone().text();
    const hmac = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(process.env.ALCHEMY_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signatureBuffer = new Uint8Array(Buffer.from(signature, 'hex'));
    const verified = await crypto.subtle.verify(
      'HMAC',
      hmac,
      signatureBuffer,
      new TextEncoder().encode(body)
    );

    return verified;
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    return false;
  }
} 