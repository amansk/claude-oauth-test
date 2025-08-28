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
app.use(express.urlencoded({ extended: true })); // Add form data parsing

// In-memory storage (resets on server restart)
const pendingAuthorizations = new Map();
const FIXED_API_KEY = 'htr_sk_02df8a9c3ab7e5009e55c223925a836c';

// Store active tokens with their associated data
// Map: access_token -> { client_id, expires_at, refresh_token, issued_at }
const activeTokens = new Map();

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

// 1. Root endpoint - redirect to /mcp (like how some MCP servers work)
app.get('/', (req, res) => {
    // Get token from query or header
    const token = req.query.access_token || 
                  (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));
    
    console.log('🔌 MCP connection attempt to root /');
    console.log('   Token provided:', token ? token.substring(0, 20) + '...' : 'None');
    console.log('   User-Agent:', req.headers['user-agent']);
    
    // Check for access token - if missing, return OAuth error with WWW-Authenticate header
    if (!token) {
        console.log('❌ No token provided at root - returning OAuth error with WWW-Authenticate header');
        
        const protocol = req.get('host').includes('railway.app') ? 'https' : req.protocol;
        const baseUrl = protocol + '://' + req.get('host');
        
        // Set WWW-Authenticate header as mentioned in the OAuth specs
        res.set('WWW-Authenticate', `Bearer realm="${baseUrl}", error="invalid_token", error_description="Missing or invalid bearer token"`);
        
        // Return simple OAuth error response (like Torch)
        return res.status(401).json({ 
            error: 'invalid_token',
            error_description: 'Missing or invalid bearer token'
        });
    }
    
    if (token !== FIXED_API_KEY) {
        console.log('❌ Invalid token at root');
        return res.status(401).json({ 
            error: 'invalid_token',
            error_description: 'Missing or invalid bearer token'
        });
    }
    
    // For GET requests with valid token, return server info
    res.json({
        name: MOCK_MCP_SERVER_INFO.name,
        version: MOCK_MCP_SERVER_INFO.version,
        status: 'ready',
        message: 'MCP server ready for JSON-RPC calls via POST'
    });
});

// Root endpoint - POST (handles JSON-RPC at root)
app.post('/', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    console.log('📮 MCP JSON-RPC message to root / endpoint');
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
            if (response !== null) {
                res.json(response);
            } else {
                // No response needed for notifications
                res.status(200).end();
            }
        } catch (error) {
            console.error('❌ MCP error at root:', error.message);
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

// Standard OAuth Server Metadata (match Torch exactly)
app.get('/.well-known/oauth-authorization-server', (req, res) => {
    const protocol = req.get('host').includes('railway.app') ? 'https' : req.protocol;
    const baseUrl = protocol + '://' + req.get('host');
    console.log('🔍 OAuth server metadata discovery requested from:', req.ip);
    
    res.json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        registration_endpoint: `${baseUrl}/oauth/register`,
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        revocation_endpoint: `${baseUrl}/oauth/token`,
        code_challenge_methods_supported: ['plain', 'S256']
    });
});

// Client Registration endpoint (required by Torch's OAuth spec)
app.post('/oauth/register', (req, res) => {
    console.log('🔐 OAuth client registration request');
    console.log('   Body:', JSON.stringify(req.body, null, 2));
    
    const clientId = crypto.randomBytes(16).toString('hex');
    const clientSecret = crypto.randomBytes(32).toString('hex');
    
    console.log('   Generated client_id:', clientId);
    console.log('   Generated client_secret:', clientSecret.substring(0, 10) + '...');
    
    // Return client registration response
    res.json({
        client_id: clientId,
        client_secret: clientSecret,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_secret_expires_at: 0, // Never expires
        redirect_uris: req.body.redirect_uris || [],
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code']
    });
});

// 3. Authorization Page (Claude opens this in browser)
app.get('/oauth/authorize', (req, res) => {
    const { 
        client_id, 
        redirect_uri, 
        state, 
        response_type, 
        scope,
        code_challenge,
        code_challenge_method 
    } = req.query;
    
    console.log('🔐 OAuth authorization request:');
    console.log('   client_id:', client_id);
    console.log('   redirect_uri:', redirect_uri);
    console.log('   state:', state);
    console.log('   response_type:', response_type);
    console.log('   scope:', scope);
    console.log('   code_challenge:', code_challenge);
    console.log('   code_challenge_method:', code_challenge_method);
    
    // Generate authorization code for Claude's standard OAuth flow
    const authCode = crypto.randomBytes(32).toString('hex');
    const userCode = generateUserCode(); // For display to user
    
    // Store authorization with all Claude's parameters including PKCE
    pendingAuthorizations.set(userCode, {
        authCode,
        authorized: false,
        clientId: client_id,
        redirectUri: redirect_uri,
        state: state, // Important: store Claude's state parameter
        responseType: response_type,
        scope: scope,
        codeChallenge: code_challenge, // PKCE challenge
        codeChallengeMethod: code_challenge_method, // PKCE method (S256)
        expires: Date.now() + 600000,
        created: new Date().toISOString()
    });
    
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
                                // Show clean success page like Torch
                                document.body.innerHTML = \`
                                    <div style="display: flex; align-items: center; justify-content: center; height: 100vh; background: #e8e8e8;">
                                        <div style="background: white; padding: 60px 80px; border-radius: 20px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                                            <div style="width: 60px; height: 60px; background: #22c55e; border-radius: 12px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                                    <polyline points="20 6 9 17 4 12"></polyline>
                                                </svg>
                                            </div>
                                            <h1 style="font-family: -apple-system, system-ui; font-size: 24px; font-weight: 600; margin: 0 0 10px; color: #1a1a1a;">Authorization Successful</h1>
                                            <p style="font-family: -apple-system, system-ui; font-size: 16px; color: #666; margin: 0;">Redirecting...</p>
                                        </div>
                                    </div>
                                \`;
                                setTimeout(() => {
                                    let redirectUrl = data.redirect_uri + '?code=' + data.auth_code;
                                    if (data.state) {
                                        redirectUrl += '&state=' + encodeURIComponent(data.state);
                                    }
                                    window.location.href = redirectUrl;
                                }, 1500);
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
                                // Show clean success page like Torch
                                document.body.innerHTML = \`
                                    <div style="display: flex; align-items: center; justify-content: center; height: 100vh; background: #e8e8e8;">
                                        <div style="background: white; padding: 60px 80px; border-radius: 20px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                                            <div style="width: 60px; height: 60px; background: #22c55e; border-radius: 12px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                                    <polyline points="20 6 9 17 4 12"></polyline>
                                                </svg>
                                            </div>
                                            <h1 style="font-family: -apple-system, system-ui; font-size: 24px; font-weight: 600; margin: 0 0 10px; color: #1a1a1a;">Authorization Successful</h1>
                                            <p style="font-family: -apple-system, system-ui; font-size: 16px; color: #666; margin: 0;">Redirecting...</p>
                                        </div>
                                    </div>
                                \`;
                                setTimeout(() => {
                                    let redirectUrl = data.redirect_uri + '?code=' + data.auth_code;
                                    if (data.state) {
                                        redirectUrl += '&state=' + encodeURIComponent(data.state);
                                    }
                                    window.location.href = redirectUrl;
                                }, 1500);
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
        state: auth.state,
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
    console.log('   Redirecting Claude to:', auth.redirectUri);
    console.log('   Authorization code:', auth.authCode);
    console.log('   State parameter:', auth.state);
    
    // Build redirect URL with authorization code and state
    const redirectUrl = new URL(auth.redirectUri);
    redirectUrl.searchParams.append('code', auth.authCode);
    if (auth.state) {
        redirectUrl.searchParams.append('state', auth.state);
    }
    
    console.log('   Full redirect URL:', redirectUrl.toString());
    
    res.json({ 
        success: true,
        message: 'Successfully connected Claude Desktop to Wellavy',
        code: code,
        redirect_url: redirectUrl.toString(),
        note: 'Claude should now be redirected automatically'
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
    // Handle both JSON and form data
    const grant_type = req.body.grant_type;
    const code = req.body.code;
    const device_code = req.body.device_code;  
    const client_id = req.body.client_id;
    const code_verifier = req.body.code_verifier; // PKCE verifier
    
    console.log('🎫 Token exchange request:');
    console.log('   Content-Type:', req.headers['content-type']);
    console.log('   Body:', JSON.stringify(req.body, null, 2));
    console.log('   Grant Type:', grant_type);
    console.log('   Code/Device Code:', (code || device_code)?.substring(0, 10) + '...');
    console.log('   Client ID:', client_id);
    console.log('   Code Verifier (PKCE):', code_verifier?.substring(0, 20) + '...' || 'None');
    
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
        
        // Generate a unique access token
        const accessToken = 'tok_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
        const refreshToken = 'ref_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
        const expiresIn = 604800; // 7 days in seconds
        
        // Store the token
        activeTokens.set(accessToken, {
            client_id: client_id || 'example-client-id',
            expires_at: Date.now() + (expiresIn * 1000),
            refresh_token: refreshToken,
            issued_at: Date.now()
        });
        
        console.log('🎫 Generated new token:', accessToken.substring(0, 20) + '...');
        console.log('   Expires in:', expiresIn, 'seconds');
        
        return res.json({
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: 'Bearer',
            expires_in: expiresIn,
            scope: 'claudeai'
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
    else if (grant_type === 'refresh_token') {
        // Handle refresh token flow
        const refresh_token = req.body.refresh_token;
        
        console.log('🔄 Refresh token request');
        
        // Find the token associated with this refresh token
        let foundToken = null;
        let foundAccessToken = null;
        for (const [accessToken, tokenData] of activeTokens.entries()) {
            if (tokenData.refresh_token === refresh_token) {
                foundToken = tokenData;
                foundAccessToken = accessToken;
                break;
            }
        }
        
        if (!foundToken) {
            console.log('❌ Invalid refresh token');
            return res.status(400).json({ error: 'invalid_grant' });
        }
        
        // Remove old token
        activeTokens.delete(foundAccessToken);
        
        // Generate new tokens
        const newAccessToken = 'tok_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
        const newRefreshToken = 'ref_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
        const expiresIn = 604800; // 7 days
        
        // Store new token
        activeTokens.set(newAccessToken, {
            client_id: foundToken.client_id,
            expires_at: Date.now() + (expiresIn * 1000),
            refresh_token: newRefreshToken,
            issued_at: Date.now()
        });
        
        console.log('✅ Token refreshed successfully');
        
        return res.json({
            access_token: newAccessToken,
            refresh_token: newRefreshToken,
            token_type: 'Bearer',
            expires_in: expiresIn,
            scope: 'claudeai'
        });
    }
    else {
        console.log('❌ Unsupported grant type:', grant_type);
        return res.status(400).json({ error: 'unsupported_grant_type' });
    }
});

// Token revocation endpoint
app.post('/oauth/revoke', (req, res) => {
    const token = req.body.token;
    const token_type_hint = req.body.token_type_hint;
    
    console.log('🔄 Token revocation request');
    console.log('   Token:', token ? token.substring(0, 20) + '...' : 'None');
    console.log('   Type hint:', token_type_hint);
    
    if (token) {
        // Find and remove the token
        let revoked = false;
        
        // Check if it's an access token
        if (activeTokens.has(token)) {
            activeTokens.delete(token);
            revoked = true;
            console.log('✅ Access token revoked');
        }
        
        // Check if it's a refresh token
        if (!revoked) {
            for (const [accessToken, tokenData] of activeTokens.entries()) {
                if (tokenData.refresh_token === token) {
                    activeTokens.delete(accessToken);
                    revoked = true;
                    console.log('✅ Refresh token revoked (and associated access token)');
                    break;
                }
            }
        }
        
        if (!revoked) {
            console.log('⚠️ Token not found in active tokens');
        }
    }
    
    // Always return 200 OK per RFC 7009
    res.status(200).end();
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
        res.set('WWW-Authenticate', `Bearer realm="${baseUrl}", error="invalid_token", error_description="Missing or invalid bearer token"`);
        
        // Return simple OAuth error response (like Torch)
        return res.status(401).json({ 
            error: 'invalid_token',
            error_description: 'Missing or invalid bearer token'
        });
    }
    
    // Check if token is valid
    const isValidToken = token === FIXED_API_KEY || activeTokens.has(token);
    if (!isValidToken) {
        console.log('❌ Invalid token');
        const protocol = req.get('host').includes('railway.app') ? 'https' : req.protocol;
        const baseUrl = protocol + '://' + req.get('host');
        res.set('WWW-Authenticate', `Bearer realm="${baseUrl}", error="invalid_token", error_description="Invalid bearer token"`);
        return res.status(401).json({ 
            error: 'invalid_token',
            error_description: 'Invalid bearer token'
        });
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
            if (response !== null) {
                res.json(response);
            } else {
                // No response needed for notifications
                res.status(200).end();
            }
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
            console.log('🔄 MCP Initialize request with params:', JSON.stringify(params, null, 2));
            // Match Claude's requested protocol version
            const requestedVersion = params?.protocolVersion || '2025-06-18';
            const initResult = {
                jsonrpc: '2.0',
                result: {
                    protocolVersion: requestedVersion, // Echo back Claude's version
                    capabilities: {
                        tools: {},
                        prompts: {},
                        resources: {}
                    },
                    serverInfo: {
                        name: MOCK_MCP_SERVER_INFO.name,
                        version: MOCK_MCP_SERVER_INFO.version
                    },
                    // Try including tools directly in initialize response
                    tools: MOCK_TOOLS
                },
                id
            };
            console.log('📤 MCP Initialize response:', JSON.stringify(initResult, null, 2));
            return initResult;
            
        case 'tools/list':
            console.log('🛠️  Tools list requested');
            console.log('   Request ID:', id);
            console.log('   Params:', JSON.stringify(params, null, 2));
            const toolsResult = {
                jsonrpc: '2.0',
                result: {
                    tools: MOCK_TOOLS
                },
                id
            };
            console.log('📤 Tools list response:', JSON.stringify(toolsResult, null, 2));
            console.log('   Number of tools:', MOCK_TOOLS.length);
            return toolsResult;
            
        case 'prompts/list':
            console.log('📝 Prompts list requested');
            return {
                jsonrpc: '2.0',
                result: {
                    prompts: [] // No prompts for now
                },
                id
            };
            
        case 'resources/list':
            console.log('📚 Resources list requested');
            return {
                jsonrpc: '2.0',
                result: {
                    resources: [] // No resources for now
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
            
        case 'notifications/initialized':
            // This is a notification, no response needed
            console.log('✅ MCP client initialized notification received');
            console.log('   Full notification:', JSON.stringify(message, null, 2));
            return null; // No response for notifications
            
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
        res.set('WWW-Authenticate', `Bearer realm="${baseUrl}", error="invalid_token", error_description="Missing or invalid bearer token"`);
        
        // Return simple OAuth error response (like Torch)
        return res.status(401).json({ 
            error: 'invalid_token',
            error_description: 'Missing or invalid bearer token'
        });
    }
    
    // Check if token is valid (either fixed API key or OAuth token)
    const isValidToken = token === FIXED_API_KEY || activeTokens.has(token);
    if (!isValidToken) {
        console.log('❌ Invalid token');
        const protocol = req.get('host').includes('railway.app') ? 'https' : req.protocol;
        const baseUrl = protocol + '://' + req.get('host');
        res.set('WWW-Authenticate', `Bearer realm="${baseUrl}", error="invalid_token", error_description="Invalid bearer token"`);
        return res.status(401).json({ 
            error: 'invalid_token',
            error_description: 'Invalid bearer token'
        });
    }
    
    console.log('✅ Valid token for GET request');
    
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
    console.log('   Full request body:', JSON.stringify(req.body, null, 2));
    console.log('   Headers:', JSON.stringify(req.headers, null, 2));
    
    // Check if token exists
    if (!token) {
        console.log('❌ No token provided');
        return res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Unauthorized - no token' },
            id: req.body?.id || null
        });
    }
    
    // Check if token is valid (either fixed API key or OAuth token)
    const isValidToken = token === FIXED_API_KEY || activeTokens.has(token);
    if (!isValidToken) {
        console.log('❌ Invalid token:', token.substring(0, 20) + '...');
        console.log('   Active tokens:', Array.from(activeTokens.keys()).map(t => t.substring(0, 20) + '...'));
        return res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Unauthorized - invalid token' },
            id: req.body?.id || null
        });
    }
    
    console.log('✅ Valid token accepted');
    
    // Handle MCP JSON-RPC messages
    if (req.body && req.body.jsonrpc === '2.0') {
        try {
            const response = await handleMcpMessage(req.body);
            if (response !== null) {
                res.json(response);
            } else {
                // No response needed for notifications
                res.status(200).end();
            }
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

// Debug endpoint to check server state
app.get('/api/debug', (req, res) => {
    res.json({
        status: 'running',
        activeTokens: activeTokens.size,
        pendingAuthorizations: pendingAuthorizations.size,
        tokens: Array.from(activeTokens.keys()).map(t => t.substring(0, 20) + '...'),
        timestamp: new Date().toISOString()
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