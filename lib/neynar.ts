export async function getFarcasterUser(walletAddress: string) {
  try {
    const response = await fetch(`/api/farcaster?address=${walletAddress}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching Farcaster user:', error);
    return null;
  }
} 