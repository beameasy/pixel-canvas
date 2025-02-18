import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BATCH_SIZE = 100;
const TOTAL_PIXELS = 1000;
const DELAY_BETWEEN_BATCHES = 2500; // ms

// Official color palette
const COLORS = [
  '#FF4500', // Orange Red
  '#FFA800', // Orange
  '#FFD635', // Yellow
  '#00A368', // Dark Green
  '#7EED56', // Light Green
  '#2450A4', // Dark Blue
  '#3690EA', // Blue
  '#51E9F4', // Light Blue
  '#811E9F', // Dark Purple
  '#B44AC0', // Purple
  '#FF99AA', // Pink
  '#9C6926', // Brown
  '#000000', // Black
  '#898D90', // Gray
  '#D4D7D9', // Light Gray
  '#FFFFFF', // White
];

async function placePixel(x: number, y: number, color: string) {
  try {
    console.log(`Placing pixel at (${x},${y}) with color ${color}`);
    const response = await fetch('http://localhost:3000/api/test/pixels', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-secret': process.env.TEST_SECRET || ''
      },
      body: JSON.stringify({ 
        x, 
        y, 
        color,
        wallet_address: '0x6E0d0A6E4cA7b2B5c8b2E59e4Fb67C8f8c8E6FE1' // Your wallet address
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.log('Response:', data);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return data;
  } catch (error) {
    console.error(`Failed to place pixel at (${x},${y}):`, error);
  }
}

async function placeBatch(startIndex: number) {
  const promises = [];
  for (let i = 0; i < BATCH_SIZE && (startIndex + i) < TOTAL_PIXELS; i++) {
    const x = Math.floor(Math.random() * 400);
    const y = Math.floor(Math.random() * 400);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    
    promises.push(placePixel(x, y, color));
  }
  
  const results = await Promise.all(promises);
  console.log(`Batch ${startIndex}: ${results.filter(r => r?.success).length}/${promises.length} successful`);
}

async function main() {
  console.log('Starting pixel placement test...');
  const startTime = Date.now();
  
  for (let i = 0; i < TOTAL_PIXELS; i += BATCH_SIZE) {
    await placeBatch(i);
    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    console.log(`Progress: ${Math.min(100, Math.floor((i + BATCH_SIZE) / TOTAL_PIXELS * 100))}%`);
  }
  
  const duration = (Date.now() - startTime) / 1000;
  console.log(`Finished placing ${TOTAL_PIXELS} pixels in ${duration} seconds`);
}

main().catch(console.error); 