// ===============================
// Debug Console - Real-time debugging
// ===============================

(function() {
    // Create debug console UI
    const debugConsole = document.createElement('div');
    debugConsole.id = 'debug-console';
    debugConsole.className = 'show'; // Start visible
    debugConsole.innerHTML = `
        <div class="debug-header">
            <h4>🐛 Debug Console - Save Tracker</h4>
            <button class="debug-clear" onclick="clearDebugLogs()">Clear</button>
        </div>
        <div id="debug-logs"></div>
    `;
    
    const debugToggle = document.createElement('button');
    debugToggle.className = 'debug-toggle';
    debugToggle.textContent = '🐛 Debug';
    debugToggle.onclick = () => {
        debugConsole.classList.toggle('show');
    };
    
    // Add to page when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            document.body.appendChild(debugConsole);
            document.body.appendChild(debugToggle);
        });
    } else {
        document.body.appendChild(debugConsole);
        document.body.appendChild(debugToggle);
    }
    
    // Debug logging function
    window.debugLog = function(message, type = 'info') {
        const logsContainer = document.getElementById('debug-logs');
        if (!logsContainer) return;
        
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `debug-log ${type}`;
        logEntry.innerHTML = `<span class="debug-timestamp">${timestamp}</span>${message}`;
        
        logsContainer.appendChild(logEntry);
        logsContainer.scrollTop = logsContainer.scrollHeight;
        
        // Keep only last 50 logs
        while (logsContainer.children.length > 50) {
            logsContainer.removeChild(logsContainer.firstChild);
        }
    };
    
    window.clearDebugLogs = function() {
        const logsContainer = document.getElementById('debug-logs');
        if (logsContainer) {
            logsContainer.innerHTML = '';
        }
    };
    
    // Override console.log to also show in debug console
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = function(...args) {
        originalLog.apply(console, args);
        const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        
        // Filter for important messages
        if (message.includes('[BULLETPROOF]') || 
            message.includes('[TASK CREATE]') || 
            message.includes('[PROJECT CREATE]') ||
            message.includes('[RENDER]') ||
            message.includes('[FIREBASE]')) {
            debugLog(message, 'info');
        }
    };
    
    console.error = function(...args) {
        originalError.apply(console, args);
        const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        debugLog('❌ ' + message, 'error');
    };
    
    debugLog('🚀 Debug console initialized', 'success');
})();
