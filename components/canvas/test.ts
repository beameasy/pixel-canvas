const { testCanvasPerformance } = require('./tests/performance');

// Mock the queuePixelUpdate function
const mockQueuePixelUpdate = (x: number, y: number, color: string) => {
  // Simulate pixel update
  process.stdout.write('.');
};

console.log('Starting test...');
testCanvasPerformance(mockQueuePixelUpdate);
console.log('\nTest finished'); 