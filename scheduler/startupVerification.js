// ===============================
// Startup Verification - Ensures all fixes are loaded
// ===============================

(function() {
    'use strict';
    
    console.log('%c🔍 STARTUP VERIFICATION', 'color: #3b82f6; font-size: 16px; font-weight: bold;');
    
    const checks = [];
    let allPassed = true;
    
    // Check 1: Firebase loaded
    if (typeof firebase !== 'undefined') {
        checks.push('✅ Firebase SDK loaded');
    } else {
        checks.push('❌ Firebase SDK NOT loaded');
        allPassed = false;
    }
    
    // Check 2: Debug console loaded
    if (typeof debugLog === 'function') {
        checks.push('✅ Debug console loaded');
    } else {
        checks.push('⚠️  Debug console NOT loaded (non-critical)');
    }
    
    // Check 3: Timestamp helper loaded
    if (typeof getTimestampValue === 'function') {
        checks.push('✅ Timestamp helper loaded');
    } else {
        checks.push('❌ Timestamp helper NOT loaded');
        allPassed = false;
    }
    
    // Check 4: State manager loaded
    if (typeof getProjectState === 'function') {
        checks.push('✅ State manager loaded');
    } else {
        checks.push('❌ State manager NOT loaded');
        allPassed = false;
    }
    
    // Check 5: Bulletproof normalize loaded
    if (typeof bulletproofNormalize === 'function') {
        checks.push('✅ Bulletproof normalize loaded');
    } else {
        checks.push('❌ Bulletproof normalize NOT loaded');
        allPassed = false;
    }
    
    // Check 6: Fixed subscriptions loaded
    if (typeof setupBulletproofSubscriptions === 'function') {
        checks.push('✅ Fixed subscriptions loaded');
    } else {
        checks.push('❌ Fixed subscriptions NOT loaded');
        allPassed = false;
    }
    
    // Display results
    console.log('%c📋 VERIFICATION RESULTS:', 'color: #f59e0b; font-size: 14px; font-weight: bold;');
    checks.forEach(check => console.log(check));
    
    if (allPassed) {
        console.log('%c\n✅ ALL CRITICAL CHECKS PASSED!\n', 'color: #10b981; font-size: 14px; font-weight: bold; background: #022c22; padding: 8px;');
        console.log('%c💡 Ready to test: Create a task or project and watch the debug console', 'color: #3b82f6; font-style: italic;');
        
        if (typeof debugLog === 'function') {
            debugLog('✅ All critical systems loaded successfully!', 'success');
            debugLog('💡 Ready to test - create a task or project', 'info');
        }
    } else {
        console.error('%c\n❌ SOME CHECKS FAILED!\n', 'color: #ef4444; font-size: 14px; font-weight: bold; background: #450a0a; padding: 8px;');
        console.error('🔧 Fix: Hard refresh the page (Cmd+Shift+R or Ctrl+Shift+R)');
        console.error('🔧 If that doesn\'t work, clear browser cache and refresh again');
        
        if (typeof debugLog === 'function') {
            debugLog('❌ Critical systems failed to load - see console', 'error');
        }
        
        alert('⚠️ Some scripts failed to load!\n\nPlease:\n1. Hard refresh (Cmd+Shift+R or Ctrl+Shift+R)\n2. Clear browser cache\n3. Check browser console (F12) for errors');
    }
    
    // Additional environment info
    console.log('\n%c📊 ENVIRONMENT INFO:', 'color: #8b5cf6; font-size: 14px; font-weight: bold;');
    console.log('Browser:', navigator.userAgent.includes('Chrome') ? 'Chrome' : navigator.userAgent.includes('Firefox') ? 'Firefox' : navigator.userAgent.includes('Safari') ? 'Safari' : 'Other');
    console.log('Window size:', window.innerWidth + 'x' + window.innerHeight);
    console.log('Timestamp:', new Date().toLocaleString());
    
})();
