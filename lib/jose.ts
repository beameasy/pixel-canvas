import { createRemoteJWKSet } from 'jose';

// Create a JWKS client with Privy's JWKS endpoint
export const JWKS = createRemoteJWKSet(
  new URL('https://auth.privy.io/api/jwks')
);

// Helper function to extract Privy ID from token
export async function extractPrivyId(token: string): Promise<string | null> {
  try {
    // Just parse the JWT payload without verification
    const [, payload] = token.split('.');
    if (!payload) return null;
    
    const decodedPayload = JSON.parse(
      Buffer.from(payload, 'base64').toString()
    );
    return decodedPayload.sub || null;
  } catch (error) {
    console.error('Error extracting Privy ID:', error);
    return null;
  }
} 