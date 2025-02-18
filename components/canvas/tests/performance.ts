export const testCanvasPerformance = (queuePixelUpdate: (x: number, y: number, color: string) => void) => {
  console.log('🧪 Starting canvas performance test...');
  console.time('Pixel Updates');
  
  // Simulate 1000 rapid pixel updates
  for (let i = 0; i < 1000; i++) {
    const x = Math.floor(Math.random() * 1358);
    const y = Math.floor(Math.random() * 1358);
    const color = `#${Math.floor(Math.random()*16777215).toString(16)}`;
    queuePixelUpdate(x, y, color);
  }
  
  console.timeEnd('Pixel Updates');
  console.log('✅ Test complete');
}; 