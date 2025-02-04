export async function getFarcasterUser(address: string) {
  try {
    if (!address) throw new Error('Address is required');

    const response = await fetch(`/api/farcaster?address=${encodeURIComponent(address)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch Farcaster user');
    }

    return data;
  } catch (error) {
    console.error('Error fetching Farcaster user:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
} 