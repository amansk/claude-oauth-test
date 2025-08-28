# Claude OAuth Test Proxy

**⚠️ TESTING ONLY** - This is a standalone OAuth proxy for testing Claude Desktop MCP connections without modifying existing code.

## Quick Start

### 1. Install & Run Locally
```bash
cd claude-oauth-test
npm install
npm start
```

Server runs on http://localhost:3001

### 2. Test with Claude Desktop
1. Open Claude Desktop
2. Go to Settings → Add custom connector
3. Enter URL: `http://localhost:3001/sse`
4. Click "Configure" - browser should open
5. Copy the code shown (e.g., `WLVY-1234`)
6. Go to wellavy.co and use the test interface
7. Enter the code and click "Connect"
8. Return to auth page and click "I'm Connected"

### 3. Deploy to Railway (Optional)
```bash
# Push to git and connect to Railway
# Or use Railway CLI:
railway up
```

## How It Works

```
Claude Desktop → OAuth Proxy → Your Real MCP Server
                (this app)     (mcp.wellavy.co)
```

1. **OAuth Discovery**: Tells Claude this server supports OAuth
2. **Authorization Page**: Shows user a code to enter in wellavy.co
3. **Code Exchange**: User enters code in wellavy.co, marking it as authorized
4. **Token Exchange**: Claude exchanges auth code for your API key
5. **MCP Proxy**: Forwards MCP requests to your real server with API key

## Key Features

- ✅ **Zero database changes** - Uses in-memory storage
- ✅ **Zero changes to existing code** - Completely standalone
- ✅ **Uses your existing API key** - No new auth system needed
- ✅ **Easy to delete** - Just remove this folder when done
- ✅ **Full logging** - See every step in the console

## Endpoints

- `GET /health` - Health check
- `GET /.well-known/mcp_oauth` - OAuth discovery (for Claude)
- `GET /oauth/authorize` - Authorization page (opens in browser)
- `POST /oauth/token` - Token exchange (for Claude)
- `GET /sse` - SSE endpoint (for Claude MCP connection)
- `POST /api/authorize-code` - Code authorization (for wellavy.co)
- `GET /debug/pending` - See pending authorizations

## Test Interface for Wellavy.co

Add this HTML to any page on wellavy.co for testing:

```html
<!-- Test Section - Add anywhere on wellavy.co -->
<div style="max-width: 500px; margin: 40px auto; padding: 30px; border: 2px solid #1976d2; border-radius: 12px; background: #f8f9fa;">
    <h3 style="color: #1976d2; margin-top: 0;">🤖 Test Claude Connection</h3>
    <p style="color: #666;">Enter the code from Claude's browser window:</p>
    <div style="display: flex; gap: 10px; margin: 20px 0;">
        <input 
            id="claude-code" 
            placeholder="WLVY-1234" 
            style="flex: 1; padding: 12px; border: 2px solid #ddd; border-radius: 6px; font-size: 16px;"
        />
        <button 
            onclick="connectClaude()" 
            style="padding: 12px 24px; background: #1976d2; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;"
        >
            Connect
        </button>
    </div>
    <div id="claude-status" style="padding: 10px; border-radius: 6px; margin-top: 10px; font-weight: 600;"></div>
</div>

<script>
function connectClaude() {
    const code = document.getElementById('claude-code').value.trim().toUpperCase();
    const statusDiv = document.getElementById('claude-status');
    
    if (!code) {
        statusDiv.style.background = '#ffebee';
        statusDiv.style.color = '#c62828';
        statusDiv.innerHTML = '❌ Please enter a code';
        return;
    }
    
    statusDiv.style.background = '#e3f2fd';
    statusDiv.style.color = '#1976d2';
    statusDiv.innerHTML = '🔄 Connecting Claude...';
    
    // Try localhost first, then deployed version
    const testUrls = [
        'http://localhost:3001/api/authorize-code',
        'https://your-railway-app.railway.app/api/authorize-code'
    ];
    
    async function tryConnect(urls, index = 0) {
        if (index >= urls.length) {
            statusDiv.style.background = '#ffebee';
            statusDiv.style.color = '#c62828';
            statusDiv.innerHTML = '❌ Could not connect to test server';
            return;
        }
        
        try {
            const response = await fetch(urls[index], {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            
            const data = await response.json();
            
            if (data.success) {
                statusDiv.style.background = '#e8f5e8';
                statusDiv.style.color = '#2e7d32';
                statusDiv.innerHTML = '✅ Claude connected successfully! You can now return to Claude.';
            } else {
                statusDiv.style.background = '#fff3e0';
                statusDiv.style.color = '#f57c00';
                statusDiv.innerHTML = '⚠️ ' + (data.error || 'Invalid or expired code');
            }
        } catch (error) {
            // Try next URL
            await tryConnect(urls, index + 1);
        }
    }
    
    tryConnect(testUrls);
}
</script>
```

## Cleanup

When testing is complete, simply delete this folder:
```bash
rm -rf claude-oauth-test
```

No other cleanup needed - nothing else was modified.

## Environment Variables

- `PORT` - Server port (default: 3001)
- No other config needed - uses hardcoded API key for testing