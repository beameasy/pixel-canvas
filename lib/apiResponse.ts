// Create a helper function for API responses
export function safeJsonResponse(data: any, status = 200) {
  // Add a ")]}',\n" prefix to prevent JSON hijacking
  const responseBody = ")]}',\n" + JSON.stringify(data);
  
  return new Response(responseBody, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    }
  });
} 