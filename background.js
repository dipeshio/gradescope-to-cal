/**
 * Background Service Worker for GradescopeToCal Extension
 * 
 * This script acts as the orchestrator for the extension, handling:
 * - Page update detection for Gradescope URLs
 * - Message passing between content scripts and popup
 * - Google Tasks sync orchestration
 */

// Import tasks service
importScripts('calendar.js');

// Listen for tab updates to detect Gradescope navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only trigger when page is fully loaded
    if (changeInfo.status === 'complete' && tab.url) {
        // Check if the URL is a Gradescope course page
        if (tab.url.match(/https:\/\/www\.gradescope\.com\/courses\/\d+/)) {
            console.log('[GradescopeToCal] Detected Gradescope course page:', tab.url);
            
            // Notify the content script to scrape assignments
            chrome.tabs.sendMessage(tabId, { action: 'scrapeAssignments' })
                .catch(err => {
                    // Content script may not be ready yet, which is fine
                    console.log('[GradescopeToCal] Content script not ready:', err.message);
                });
        }
    }
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    
    // Handle scraped assignments from content script
    if (message.action === 'assignmentsScraped') {
        chrome.storage.local.set({ 
            assignments: message.data,
            lastUpdated: Date.now(),
            courseUrl: sender.tab?.url || ''
        }, () => {
            console.log('[GradescopeToCal] Stored', message.data.length, 'assignments');
            sendResponse({ success: true });
        });
        return true;
    }
    
    // Handle get assignments request from popup
    if (message.action === 'getAssignments') {
        chrome.storage.local.get(['assignments', 'lastUpdated', 'courseUrl'], (result) => {
            sendResponse(result);
        });
        return true;
    }
    
    // Handle tasks sync request
    if (message.action === 'syncToTasks') {
        handleTasksSync(message.assignments)
            .then(results => sendResponse({ success: true, results }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
    
    // Handle authentication check
    if (message.action === 'checkAuth') {
        checkAuthentication()
            .then(isAuthenticated => sendResponse({ isAuthenticated }))
            .catch(() => sendResponse({ isAuthenticated: false }));
        return true;
    }
    
    // Handle sign out
    if (message.action === 'signOut') {
        handleSignOut()
            .then(() => sendResponse({ success: true }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
    
    return false;
});

/**
 * Handle tasks sync request
 * @param {Array} assignments - Assignments to sync
 * @returns {Promise<Object>} Sync results
 */
async function handleTasksSync(assignments) {
    console.log('[GradescopeToCal] Starting tasks sync for', assignments.length, 'assignments');
    
    if (!assignments || assignments.length === 0) {
        throw new Error('No assignments to sync');
    }
    
    const results = await self.tasksService.syncAssignmentsToTasks(assignments);
    
    console.log('[GradescopeToCal] Sync complete:', results);
    return results;
}

/**
 * Check if user is authenticated with Google
 * @returns {Promise<boolean>}
 */
async function checkAuthentication() {
    try {
        const token = await self.tasksService.getAuthToken(false);
        return !!token;
    } catch {
        return false;
    }
}

/**
 * Sign out from Google
 */
async function handleSignOut() {
    try {
        const token = await self.tasksService.getAuthToken(false);
        if (token) {
            await self.tasksService.removeCachedToken(token);
        }
    } catch (err) {
        console.log('[GradescopeToCal] Sign out:', err.message);
    }
}

console.log('[GradescopeToCal] Background service worker initialized with Google Tasks support');
