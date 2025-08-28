const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors({
    origin: '*',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'OPTIONS'],
    exposedHeaders: ['WWW-Authenticate'],
    maxAge: 86400
}));
app.use(express.json());

// In-memory storage (resets on server restart)
const pendingAuthorizations = new Map();
const FIXED_API_KEY = 'htr_sk_02df8a9c3ab7e5009e55c223925a836c';

// Mock MCP Server - completely standalone
const MOCK_MCP_SERVER_INFO = {
    name: "Wellavy Test MCP Server",
    version: "1.0.0"
};

const MOCK_TOOLS = [
    {
        name: "test_tool",
        description: "A simple test tool that responds with OK",
        inputSchema: {
            type: "object",
            properties: {
                message: {
                    type: "string",
                    description: "Optional message to include in response"
                }
            }
        }
    }
];

console.log('🚀 Claude OAuth Test MCP Server Starting...');
console.log('📋 Using API Key:', FIXED_API_KEY.substring(0, 20) + '...');
console.log('🧪 Mock MCP Server with test_tool');

// Generate short user code
function generateUserCode() {
    return 'WLVY-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}

// Clean up expired codes
function cleanupExpiredCodes() {
    const now = Date.now();
    for (const [code, auth] of pendingAuthorizations.entries()) {
        if (auth.expires < now) {
            console.log('🗑️  Cleaning up expired code:', code);
            pendingAuthorizations.delete(code);
        }
    }
}

// Clean up expired codes every minute
setInterval(cleanupExpiredCodes, 60000);

// 1. Root endpoint with OAuth info
app.get('/', (req, res) => {
    res.json({
        name: 'Claude OAuth Test Proxy',
        version: '1.0.0',
        endpoints: {
            sse: '/sse (requires access_token)',
            oauth_discovery: '/.well-known/mcp_oauth',
            authorize: '/oauth/authorize',
            token: '/oauth/token'
        },
        instructions: 'Add this URL to Claude Desktop: /sse'
    });
});

// 2. Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        server: 'claude-oauth-test-proxy',
        pendingCodes: pendingAuthorizations.size,
        timestamp: new Date().toISOString()
    });
});

// 2. OAuth Discovery (tells Claude about OAuth capabilities)
app.get('/.well-known/mcp_oauth', (req, res) => {
    // Force HTTPS for production URLs
    const protocol = req.get('host').includes('railway.app') ? 'https' : req.protocol;
    const baseUrl = protocol + '://' + req.get('host');
    console.log('🔍 MCP OAuth discovery requested from:', req.ip);
    
    res.json({
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        device_authorization_endpoint: `${baseUrl}/oauth/device`,
        supported_response_types: ['code'],
        grant_types_supported: ['authorization_code', 'urn:ietf:params:oauth:grant-type:device_code']
    });
});

// Standard OAuth Server Metadata (as per search results)
app.get('/.well-known/oauth-authorization-server', (req, res) => {
    const protocol = req.get('host').includes('railway.app') ? 'https' : req.protocol;
    const baseUrl = protocol + '://' + req.get('host');
    console.log('🔍 OAuth server metadata discovery requested from:', req.ip);
    
    res.json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        device_authorization_endpoint: `${baseUrl}/oauth/device`,
        registration_endpoint: `${baseUrl}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'urn:ietf:params:oauth:grant-type:device_code'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
        code_challenge_methods_supported: ['S256', 'plain'],
        scopes_supported: ['read:health_data']
    });
});

// 3. Authorization Page (Claude opens this in browser)
app.get('/oauth/authorize', (req, res) => {
    // Check if user_code and auth_code are provided (from device flow)
    let userCode = req.query.user_code;
    let authCode = req.query.auth_code;
    
    // If not provided, generate new ones (for manual testing)
    if (!userCode || !authCode) {
        userCode = generateUserCode();
        authCode = crypto.randomBytes(32).toString('hex');
        
        // Store authorization for manual testing
        pendingAuthorizations.set(userCode, {
            authCode,
            authorized: false,
            redirectUri: req.query.redirect_uri,
            clientId: req.query.client_id || 'manual-test',
            expires: Date.now() + 600000,
            created: new Date().toISOString()
        });
    }
    
    // Force HTTPS for production URLs
    const protocol = req.get('host').includes('railway.app') ? 'https' : req.protocol;
    const baseUrl = protocol + '://' + req.get('host');
    
    console.log('🔐 New authorization request:');
    console.log('   User Code:', userCode);
    console.log('   Auth Code:', authCode.substring(0, 10) + '...');
    console.log('   Redirect URI:', req.query.redirect_uri);
    console.log('   Expires in: 10 minutes');
    
    // Clean up expired codes
    cleanupExpiredCodes();
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Connect Wellavy to Claude Desktop</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                * { box-sizing: border-box; }
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui; 
                    max-width: 600px; 
                    margin: 0 auto; 
                    padding: 20px;
                    background: #f8f9fa;
                    line-height: 1.6;
                }
                .container {
                    background: white;
                    padding: 40px;
                    border-radius: 12px;
                    box-shadow: 0 2px 20px rgba(0,0,0,0.1);
                    text-align: center;
                }
                .header { color: #1976d2; margin-bottom: 30px; }
                .code { 
                    font-size: 32px; 
                    background: linear-gradient(135deg, #e3f2fd, #f3e5f5);
                    padding: 25px; 
                    margin: 30px 0; 
                    border-radius: 12px;
                    border: 3px solid #1976d2;
                    font-family: 'Monaco', 'Courier New', monospace;
                    letter-spacing: 3px;
                    font-weight: bold;
                    color: #1976d2;
                }
                .steps { 
                    text-align: left; 
                    background: #f0f7ff; 
                    padding: 25px; 
                    border-radius: 12px; 
                    margin: 30px 0;
                    border-left: 4px solid #1976d2;
                }
                .steps ol { margin: 0; padding-left: 20px; }
                .steps li { margin: 10px 0; font-size: 16px; }
                .steps strong { color: #1976d2; }
                button { 
                    background: #1976d2; 
                    color: white; 
                    border: none; 
                    padding: 15px 30px; 
                    border-radius: 8px; 
                    cursor: pointer;
                    font-size: 16px;
                    margin: 10px;
                    transition: all 0.2s;
                    font-weight: 600;
                }
                button:hover { 
                    background: #1565c0; 
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(25, 118, 210, 0.3);
                }
                .cancel { background: #757575 !important; }
                .cancel:hover { background: #616161 !important; }
                .copy-btn { 
                    background: #4caf50 !important; 
                    font-size: 14px; 
                    padding: 10px 20px;
                    margin-top: 15px;
                }
                .copy-btn:hover { background: #45a049 !important; }
                #status { 
                    margin-top: 20px; 
                    padding: 15px;
                    border-radius: 8px;
                    font-weight: 600;
                }
                .success { background: #e8f5e8; color: #2e7d32; }
                .error { background: #ffebee; color: #c62828; }
                .info { background: #e3f2fd; color: #1976d2; }
                .warning { background: #fff3e0; color: #f57c00; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1 class="header">🔗 Connect Claude Desktop to Wellavy</h1>
                
                <div class="code">
                    <div style="font-size: 16px; margin-bottom: 10px; color: #666;">Your connection code:</div>
                    <span id="userCode">${userCode}</span>
                    <div>
                        <button onclick="copyCode()" class="copy-btn">📋 Copy Code</button>
                    </div>
                </div>
                
                <div class="steps">
                    <h3 style="margin-top: 0; color: #1976d2;">Steps to connect:</h3>
                    <ol>
                        <li><strong>Copy the code above</strong> (click the copy button)</li>
                        <li>Go to <strong>wellavy.co</strong> and make sure you're logged in</li>
                        <li>Scroll down to find the <strong>"Test Claude Connection"</strong> section</li>
                        <li><strong>Paste the code</strong> and click "Connect"</li>
                        <li>Come back here and click <strong>"I'm Connected"</strong></li>
                    </ol>
                    <div style="background: #fff3e0; padding: 15px; border-radius: 8px; margin-top: 15px; font-size: 14px; color: #f57c00;">
                        <strong>⏰ This code expires in 10 minutes</strong>
                    </div>
                </div>
                
                <div>
                    <button onclick="checkConnection()">✅ I'm Connected</button>
                    <button onclick="window.close()" class="cancel">❌ Cancel</button>
                </div>
                
                <div id="status"></div>
                
                <div style="margin-top: 30px; padding: 20px; background: #f5f5f5; border-radius: 8px; font-size: 12px; color: #666;">
                    <strong>Debug Info:</strong><br>
                    Server: ${baseUrl}<br>
                    Code: ${userCode}<br>
                    Created: ${new Date().toLocaleTimeString()}
                </div>
            </div>
            
            <script>
                function copyCode() {
                    const code = document.getElementById('userCode').textContent;
                    navigator.clipboard.writeText(code).then(() => {
                        showStatus('✅ Code copied! Now go to wellavy.co', 'success');
                    }).catch(() => {
                        // Fallback for older browsers
                        const textArea = document.createElement('textarea');
                        textArea.value = code;
                        document.body.appendChild(textArea);
                        textArea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textArea);
                        showStatus('✅ Code copied!', 'success');
                    });
                }
                
                function showStatus(message, type = 'info') {
                    const statusDiv = document.getElementById('status');
                    statusDiv.innerHTML = message;
                    statusDiv.className = type;
                }
                
                function checkConnection() {
                    showStatus('🔄 Checking connection...', 'info');
                    
                    fetch('/oauth/check?code=${userCode}')
                        .then(r => r.json())
                        .then(data => {
                            console.log('Check response:', data);
                            if (data.authorized) {
                                showStatus('✅ Connected successfully! Redirecting Claude...', 'success');
                                setTimeout(() => {
                                    const redirectUrl = data.redirect_uri + '?code=' + data.auth_code;
                                    console.log('Redirecting to:', redirectUrl);
                                    window.location.href = redirectUrl;
                                }, 2000);
                            } else if (data.expired) {
                                showStatus('❌ Code has expired. Please refresh and try again.', 'error');
                            } else {
                                showStatus('⏳ Not connected yet. Please complete step 4 in wellavy.co', 'warning');
                            }
                        })
                        .catch(err => {
                            console.error('Check failed:', err);
                            showStatus('❌ Check failed. Please try again.', 'error');
                        });
                }
                
                // Auto-check every 3 seconds
                const autoCheckInterval = setInterval(() => {
                    // Don't auto-check if user is actively checking
                    const status = document.getElementById('status').textContent;
                    if (status.includes('🔄')) return;
                    
                    fetch('/oauth/check?code=${userCode}')
                        .then(r => r.json())
                        .then(data => {
                            if (data.authorized) {
                                clearInterval(autoCheckInterval);
                                showStatus('✅ Auto-detected connection! Redirecting...', 'success');
                                setTimeout(() => {
                                    const redirectUrl = data.redirect_uri + '?code=' + data.auth_code;
                                    window.location.href = redirectUrl;
                                }, 2000);
                            }
                        })
                        .catch(() => {
                            // Silently ignore auto-check errors
                        });
                }, 3000);
                
                // Stop auto-checking after 10 minutes
                setTimeout(() => {
                    clearInterval(autoCheckInterval);
                }, 600000);
            </script>
        </body>
        </html>
    `);
});

// 4. Check authorization status (polled by the auth page)
app.get('/oauth/check', (req, res) => {
    const code = req.query.code;
    const auth = pendingAuthorizations.get(code);
    
    if (!auth) {
        console.log('❌ Check failed: Code not found:', code);
        return res.json({ authorized: false, error: 'Code not found' });
    }
    
    if (auth.expires < Date.now()) {
        console.log('⏰ Check failed: Code expired:', code);
        pendingAuthorizations.delete(code);
        return res.json({ authorized: false, expired: true });
    }
    
    console.log('🔍 Status check for', code, '- Authorized:', auth.authorized);
    
    res.json({
        authorized: auth.authorized,
        redirect_uri: auth.redirectUri,
        auth_code: auth.authCode,
        expires_in: Math.floor((auth.expires - Date.now()) / 1000)
    });
});

// 5. Authorize code (called from wellavy.co test interface)
app.post('/api/authorize-code', (req, res) => {
    const { code } = req.body;
    
    console.log('🔐 Authorization attempt for code:', code);
    
    if (!code) {
        console.log('❌ No code provided');
        return res.json({ success: false, error: 'Code is required' });
    }
    
    const auth = pendingAuthorizations.get(code);
    
    if (!auth) {
        console.log('❌ Code not found:', code);
        return res.json({ success: false, error: 'Invalid code' });
    }
    
    if (auth.expires < Date.now()) {
        console.log('⏰ Code expired:', code);
        pendingAuthorizations.delete(code);
        return res.json({ success: false, error: 'Code expired' });
    }
    
    if (auth.authorized) {
        console.log('⚠️  Code already authorized:', code);
        return res.json({ success: true, message: 'Already authorized' });
    }
    
    // Mark as authorized
    auth.authorized = true;
    auth.authorizedAt = new Date().toISOString();
    
    console.log('✅ Code authorized successfully:', code);
    console.log('   Will redirect Claude to:', auth.redirectUri);
    
    res.json({ 
        success: true,
        message: 'Successfully connected Claude Desktop to Wellavy',
        code: code
    });
});

// 6. Device authorization endpoint (Claude should call this first)
app.post('/oauth/device', (req, res) => {
    const clientId = req.body.client_id || 'claude-desktop';
    const scope = req.body.scope || 'read:health_data';
    
    console.log('📱 Device authorization request:');
    console.log('   Client ID:', clientId);
    console.log('   Scope:', scope);
    
    const userCode = generateUserCode();
    const deviceCode = crypto.randomBytes(32).toString('hex');
    const protocol = req.get('host').includes('railway.app') ? 'https' : req.protocol;
    const baseUrl = protocol + '://' + req.get('host');
    
    // Store device authorization
    pendingAuthorizations.set(userCode, {
        deviceCode,
        authorized: false,
        clientId,
        scope,
        expires: Date.now() + 600000, // 10 minutes
        created: new Date().toISOString()
    });
    
    console.log('🔐 Generated device authorization:');
    console.log('   User Code:', userCode);
    console.log('   Device Code:', deviceCode.substring(0, 10) + '...');
    
    // Return device authorization response
    res.json({
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: `${baseUrl}/device`,
        verification_uri_complete: `${baseUrl}/device?user_code=${userCode}`,
        expires_in: 600,
        interval: 5
    });
});

// Device verification page (where user enters the code)
app.get('/device', (req, res) => {
    const userCode = req.query.user_code || '';
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Connect Claude Desktop to Wellavy</title>
            <style>
                body { font-family: system-ui; max-width: 500px; margin: 100px auto; text-align: center; }
                .code { font-size: 24px; background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px; }
                input { padding: 10px; font-size: 16px; margin: 10px; }
                button { background: #007bff; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; }
            </style>
        </head>
        <body>
            <h1>🔗 Connect Claude Desktop</h1>
            
            ${userCode ? `
                <div class="code">
                    <strong>Your device code:</strong><br>
                    <span>${userCode}</span>
                </div>
                <p>Go to <strong>wellavy.co</strong> and enter this code to connect Claude.</p>
            ` : `
                <p>Enter the code shown in Claude Desktop:</p>
                <input id="codeInput" placeholder="WLVY-1234" value="${userCode}" />
                <br>
                <button onclick="authorize()">Authorize Device</button>
            `}
            
            <div id="status"></div>
            
            <script>
                function authorize() {
                    const code = document.getElementById('codeInput').value;
                    // This would authorize the device code
                    document.getElementById('status').innerHTML = 'Device authorized! Claude should connect now.';
                }
            </script>
        </body>
        </html>
    `);
});

// 7. Token exchange (supports both authorization_code and device_code flows)
app.post('/oauth/token', (req, res) => {
    const { grant_type, code, device_code, client_id } = req.body;
    
    console.log('🎫 Token exchange request:');
    console.log('   Grant Type:', grant_type);
    console.log('   Code/Device Code:', (code || device_code)?.substring(0, 10) + '...');
    console.log('   Client ID:', client_id);
    
    if (grant_type === 'authorization_code') {
        // Handle authorization code flow (from redirects)
        let foundAuth = null;
        let foundUserCode = null;
        for (const [userCode, auth] of pendingAuthorizations.entries()) {
            if (auth.authCode === code && auth.authorized) {
                foundAuth = auth;
                foundUserCode = userCode;
                break;
            }
        }
        
        if (!foundAuth) {
            console.log('❌ Invalid or unauthorized authorization code');
            return res.status(400).json({ error: 'invalid_grant' });
        }
        
        console.log('✅ Authorization code exchange successful for:', foundUserCode);
        pendingAuthorizations.delete(foundUserCode);
        
        return res.json({
            access_token: FIXED_API_KEY,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'read:health_data'
        });
    } 
    else if (grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
        // Handle device code flow (proper OAuth device flow)
        let foundAuth = null;
        let foundUserCode = null;
        for (const [userCode, auth] of pendingAuthorizations.entries()) {
            if (auth.deviceCode === device_code) {
                foundAuth = auth;
                foundUserCode = userCode;
                break;
            }
        }
        
        if (!foundAuth) {
            console.log('❌ Invalid device code');
            return res.status(400).json({ error: 'invalid_grant' });
        }
        
        if (!foundAuth.authorized) {
            console.log('⏳ Device code not yet authorized');
            return res.status(400).json({ error: 'authorization_pending' });
        }
        
        if (foundAuth.expires < Date.now()) {
            console.log('⏰ Device code expired');
            pendingAuthorizations.delete(foundUserCode);
            return res.status(400).json({ error: 'expired_token' });
        }
        
        console.log('✅ Device code exchange successful for:', foundUserCode);
        pendingAuthorizations.delete(foundUserCode);
        
        return res.json({
            access_token: FIXED_API_KEY,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: foundAuth.scope || 'read:health_data'
        });
    }
    else {
        console.log('❌ Unsupported grant type:', grant_type);
        return res.status(400).json({ error: 'unsupported_grant_type' });
    }
});

// 7. SSE Endpoint (Claude connects here for MCP communication)
app.get('/sse', async (req, res) => {
    // Get token from query or header
    const token = req.query.access_token || 
                  (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));
    
    console.log('🔌 SSE connection attempt');
    console.log('   Token provided:', token ? token.substring(0, 20) + '...' : 'None');
    console.log('   User-Agent:', req.headers['user-agent']);
    console.log('   Full URL:', req.url);
    
    // Check for access token - if missing, return OAuth error with WWW-Authenticate header
    if (!token) {
        console.log('❌ No token provided - returning OAuth error with WWW-Authenticate header');
        
        const protocol = req.get('host').includes('railway.app') ? 'https' : req.protocol;
        const baseUrl = protocol + '://' + req.get('host');
        
        // Set WWW-Authenticate header as mentioned in the OAuth specs
        res.set('WWW-Authenticate', `Bearer realm="${baseUrl}", error="invalid_token", error_description="The access token is missing"`);
        
        // Return simple OAuth error response (like Torch)
        return res.status(401).json({ 
            error: 'invalid_token',
            error_description: 'Missing or invalid bearer token'
        });
    }
    
    if (token !== FIXED_API_KEY) {
        console.log('❌ Invalid token');
        return res.status(401).json({ error: 'Invalid access token' });
    }
    
    console.log('✅ SSE connection authorized');
    
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });
    
    console.log('📡 SSE connection established - waiting for MCP initialize message');
    
    // Instead of sending initial data, wait for Claude to send MCP messages
    // Claude expects to initiate the MCP handshake, not receive immediate data
    
    // Keep connection alive with periodic pings (but don't send them immediately)
    const pingInterval = setInterval(() => {
        try {
            // Only send pings after connection has been established for a while
            // and no real MCP communication is happening
            res.write('data: {"type":"ping","timestamp":"' + new Date().toISOString() + '"}\\n\\n');
        } catch (err) {
            console.log('📡 SSE connection closed during ping');
            clearInterval(pingInterval);
        }
    }, 60000); // Longer interval to avoid interfering with MCP protocol
    
    // Clean up on client disconnect
    req.on('close', () => {
        console.log('📡 SSE connection closed by client');
        clearInterval(pingInterval);
    });
});

// Handle MCP messages via POST to SSE endpoint
app.post('/sse', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.body.access_token;
    
    console.log('📮 MCP JSON-RPC message to SSE endpoint');
    console.log('   Method:', req.body?.method);
    console.log('   Token:', token ? token.substring(0, 20) + '...' : 'None');
    
    // Check authentication
    if (!token || token !== FIXED_API_KEY) {
        return res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Unauthorized' },
            id: req.body?.id || null
        });
    }
    
    // Handle MCP JSON-RPC messages
    if (req.body && req.body.jsonrpc === '2.0') {
        try {
            const response = await handleMcpMessage(req.body);
            res.json(response);
        } catch (error) {
            console.error('❌ MCP error:', error.message);
            res.json({
                jsonrpc: '2.0',
                error: { code: -32000, message: error.message },
                id: req.body.id || null
            });
        }
    } else {
        res.status(400).json({ error: 'Expected MCP JSON-RPC 2.0 message' });
    }
});

// Mock MCP message handler
async function handleMcpMessage(message) {
    const { method, params, id } = message;
    
    console.log('🔧 Handling MCP method:', method);
    
    switch (method) {
        case 'initialize':
            return {
                jsonrpc: '2.0',
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: {}
                    },
                    serverInfo: MOCK_MCP_SERVER_INFO
                },
                id
            };
            
        case 'tools/list':
            return {
                jsonrpc: '2.0',
                result: {
                    tools: MOCK_TOOLS
                },
                id
            };
            
        case 'tools/call':
            const toolName = params?.name;
            const toolArgs = params?.arguments || {};
            
            console.log('🛠️  Tool call:', toolName, 'with args:', toolArgs);
            
            if (toolName === 'test_tool') {
                const message = toolArgs.message || 'Hello from test tool!';
                return {
                    jsonrpc: '2.0',
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: `✅ OK: ${message}\n\nThis is a mock response from the test MCP server. The OAuth flow worked successfully!`
                            }
                        ]
                    },
                    id
                };
            } else {
                throw new Error(`Unknown tool: ${toolName}`);
            }
            
        default:
            throw new Error(`Unsupported method: ${method}`);
    }
}

// Alternative MCP endpoint - GET (like Torch)
app.get('/mcp', async (req, res) => {
    // Get token from query or header
    const token = req.query.access_token || 
                  (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));
    
    console.log('🔌 MCP GET connection attempt');
    console.log('   Token provided:', token ? token.substring(0, 20) + '...' : 'None');
    console.log('   User-Agent:', req.headers['user-agent']);
    console.log('   Full URL:', req.url);
    
    // Check for access token - if missing, return OAuth error with WWW-Authenticate header
    if (!token) {
        console.log('❌ No token provided - returning OAuth error with WWW-Authenticate header');
        
        const protocol = req.get('host').includes('railway.app') ? 'https' : req.protocol;
        const baseUrl = protocol + '://' + req.get('host');
        
        // Set WWW-Authenticate header as mentioned in the OAuth specs
        res.set('WWW-Authenticate', `Bearer realm="${baseUrl}", error="invalid_token", error_description="The access token is missing"`);
        
        // Return simple OAuth error response (like Torch)
        return res.status(401).json({ 
            error: 'invalid_token',
            error_description: 'Missing or invalid bearer token'
        });
    }
    
    if (token !== FIXED_API_KEY) {
        console.log('❌ Invalid token');
        return res.status(401).json({ error: 'Invalid access token' });
    }
    
    // For GET requests, return server info (like Torch might do)
    res.json({
        name: MOCK_MCP_SERVER_INFO.name,
        version: MOCK_MCP_SERVER_INFO.version,
        status: 'ready',
        message: 'MCP server ready for JSON-RPC calls via POST'
    });
});

// MCP endpoint - POST (handles JSON-RPC)
app.post('/mcp', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    console.log('📮 MCP JSON-RPC message to /mcp endpoint');
    console.log('   Method:', req.body?.method);
    console.log('   Token:', token ? token.substring(0, 20) + '...' : 'None');
    
    if (!token || token !== FIXED_API_KEY) {
        return res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Unauthorized' },
            id: req.body?.id || null
        });
    }
    
    // Handle MCP JSON-RPC messages
    if (req.body && req.body.jsonrpc === '2.0') {
        try {
            const response = await handleMcpMessage(req.body);
            res.json(response);
        } catch (error) {
            console.error('❌ MCP error:', error.message);
            res.json({
                jsonrpc: '2.0',
                error: { code: -32000, message: error.message },
                id: req.body.id || null
            });
        }
    } else {
        res.status(400).json({ error: 'Expected MCP JSON-RPC 2.0 message' });
    }
});

// 9. Debug endpoint to see pending authorizations
app.get('/debug/pending', (req, res) => {
    const pending = Array.from(pendingAuthorizations.entries()).map(([code, auth]) => ({
        userCode: code,
        authorized: auth.authorized,
        created: auth.created,
        expiresIn: Math.floor((auth.expires - Date.now()) / 1000) + 's'
    }));
    
    res.json({
        server: 'claude-oauth-test-proxy',
        pendingAuthorizations: pending,
        totalPending: pending.length
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log('\\n🚀 Claude OAuth Test Proxy Started!');
    console.log('📍 Server running on port:', PORT);
    console.log('🔗 Test URL for Claude: http://localhost:' + PORT + '/sse');
    console.log('🔍 Health check: http://localhost:' + PORT + '/health');
    console.log('🐛 Debug pending: http://localhost:' + PORT + '/debug/pending');
    console.log('\\n📋 Copy this URL for Claude Desktop:');
    console.log('   http://localhost:' + PORT + '/sse');
    console.log('\\n🎯 Next steps:');
    console.log('   1. Add the URL above to Claude Desktop');
    console.log('   2. Click Configure when prompted');
    console.log('   3. Follow instructions in the browser');
    console.log('   4. Test with the interface on wellavy.co');
    console.log('\\n---\\n');
});