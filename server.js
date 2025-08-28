const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory storage (resets on server restart)
const pendingAuthorizations = new Map();
const FIXED_API_KEY = 'htr_sk_02df8a9c3ab7e5009e55c223925a836c';
const REAL_MCP_SERVER = 'https://mcp.wellavy.co';

console.log('🚀 Claude OAuth Test Proxy Starting...');
console.log('📋 Using API Key:', FIXED_API_KEY.substring(0, 20) + '...');
console.log('🔗 Proxying to:', REAL_MCP_SERVER);

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
    console.log('🔍 OAuth discovery requested from:', req.ip);
    
    res.json({
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        supported_response_types: ['code'],
        grant_types_supported: ['authorization_code']
    });
});

// 3. Authorization Page (Claude opens this in browser)
app.get('/oauth/authorize', (req, res) => {
    const userCode = generateUserCode();
    const authCode = crypto.randomBytes(32).toString('hex');
    // Force HTTPS for production URLs
    const protocol = req.get('host').includes('railway.app') ? 'https' : req.protocol;
    const baseUrl = protocol + '://' + req.get('host');
    
    // Store in memory with expiration
    pendingAuthorizations.set(userCode, {
        authCode,
        authorized: false,
        redirectUri: req.query.redirect_uri,
        clientId: req.query.client_id,
        expires: Date.now() + 600000, // 10 minutes
        created: new Date().toISOString()
    });
    
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

// 6. Token exchange (Claude calls this after redirect)
app.post('/oauth/token', (req, res) => {
    const { grant_type, code, client_id, redirect_uri } = req.body;
    
    console.log('🎫 Token exchange request:');
    console.log('   Grant Type:', grant_type);
    console.log('   Code:', code?.substring(0, 10) + '...');
    console.log('   Client ID:', client_id);
    
    if (grant_type !== 'authorization_code') {
        console.log('❌ Invalid grant type:', grant_type);
        return res.status(400).json({ error: 'unsupported_grant_type' });
    }
    
    // Find authorization by auth_code
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
        console.log('❌ Invalid or unauthorized code');
        return res.status(400).json({ error: 'invalid_grant' });
    }
    
    console.log('✅ Token exchange successful for user code:', foundUserCode);
    console.log('   Returning API key:', FIXED_API_KEY.substring(0, 20) + '...');
    
    // Clean up the used authorization
    pendingAuthorizations.delete(foundUserCode);
    
    res.json({
        access_token: FIXED_API_KEY,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'read:health_data'
    });
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
    
    // For testing, let's see what Claude is actually sending
    if (!token) {
        console.log('❌ No token provided, checking if this is Claude Desktop...');
        
        // If this looks like Claude Desktop, let's provide OAuth discovery
        const userAgent = req.headers['user-agent'] || '';
        if (userAgent.includes('Claude') || userAgent.includes('Anthropic')) {
            console.log('🔍 Detected Claude client, redirecting to OAuth discovery');
            return res.redirect('/.well-known/mcp_oauth');
        }
        
        console.log('❌ Invalid or missing token');
        return res.status(401).json({ 
            error: 'Invalid or missing access token',
            hint: 'Try OAuth discovery at /.well-known/mcp_oauth'
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
    
    // Send initial connection confirmation
    res.write('data: {"type":"connection","status":"connected","server":"claude-oauth-test-proxy"}\\n\\n');
    
    console.log('📡 SSE connection established - Claude should now be able to use MCP tools');
    
    // For testing, we'll forward to your real MCP server
    // In a real implementation, you'd maintain the SSE connection and proxy all MCP messages
    
    // Keep connection alive with periodic pings
    const pingInterval = setInterval(() => {
        try {
            res.write('data: {"type":"ping","timestamp":"' + new Date().toISOString() + '"}\\n\\n');
        } catch (err) {
            console.log('📡 SSE connection closed');
            clearInterval(pingInterval);
        }
    }, 30000);
    
    // Clean up on client disconnect
    req.on('close', () => {
        console.log('📡 SSE connection closed by client');
        clearInterval(pingInterval);
    });
});

// 8. Proxy MCP requests to real server (for testing)
app.post('/mcp', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token || token !== FIXED_API_KEY) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    
    try {
        console.log('🔄 Proxying MCP request to real server');
        
        const response = await fetch(`${REAL_MCP_SERVER}/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${FIXED_API_KEY}`
            },
            body: JSON.stringify(req.body)
        });
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('❌ Proxy error:', error.message);
        res.status(500).json({ error: 'Proxy failed', details: error.message });
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