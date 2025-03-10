/**
 * Safely fetches JSON data with anti-hijacking protection
 */
import JSON5 from 'json5';
import sjson from 'secure-json-parse';

export async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<any> {
  const response = await fetch(input, init);
  
  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }
  
  const text = await response.text();
  
  // Remove anti-hijacking prefix if present
  const safeText = text.replace(/^\)\]\}',\n/, '');
  
  try {
    // First sanitize with JSON5 if needed, then secure parse
    return sjson.parse(safeText, { protoAction: 'remove' });
  } catch (error) {
    console.error('Failed to parse JSON:', error);
    throw new Error('Invalid JSON response');
  }
} 