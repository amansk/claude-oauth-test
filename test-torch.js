const https = require('https');

// Try to see what Torch returns for various endpoints
const testEndpoints = [
  { path: '/mcp', method: 'GET' },
  { path: '/.well-known/oauth-authorization-server', method: 'GET' }
];

testEndpoints.forEach(endpoint => {
  const options = {
    hostname: 'mcp.torchapp.com',
    port: 443,
    path: endpoint.path,
    method: endpoint.method,
    headers: {
      'User-Agent': 'Test/1.0'
    }
  };

  const req = https.request(options, (res) => {
    console.log(`\n${endpoint.method} ${endpoint.path}:`);
    console.log(`Status: ${res.statusCode}`);
    console.log('Headers:', JSON.stringify(res.headers, null, 2));
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('Response:', data);
    });
  });

  req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
  });

  req.end();
});