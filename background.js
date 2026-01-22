/**
 * Background Service Worker for GradescopeToCal Extension
 * 
 * Orchestrator:
 * - Gradescope detection
 * - Message passing
 * - "Ghost Window" management for auto-processing tasks
 */

importScripts('config.js', 'calendar.js');

// Sync lock to prevent duplicate concurrent syncs
let isSyncing = false;
let lastSyncUrl = '';
let lastSyncTime = 0;
const SYNC_DEBOUNCE_MS = 5000; // 5 second debounce

// Listen for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        
        // 1. Gradescope Logic (also matches localhost for testing)
        if (tab.url.match(/https:\/\/www\.gradescope\.com\/courses\/\d+/) || 
            tab.url.match(/http:\/\/localhost:8000/)) {
            console.log('[GradescopeToCal] Detected Gradescope/test page:', tab.url);
            chrome.tabs.sendMessage(tabId, { action: 'scrapeAssignments' })
                .catch(err => console.log('[GradescopeToCal] Content script not ready:', err.message));
        }

        // 2. Calendar Logic - Only trigger if there's a pending sync
        if (tab.url.includes('calendar.google.com/calendar') && !tab.url.includes('/tasks')) {
            checkAndProcessPendingSync();
        }
    }
});

// Queue to track pending task completions
let taskCompletionResolver = null;

// Check if there's a pending sync that needs time processing
async function checkAndProcessPendingSync() {
    // Get count of tasks to process
    const { pendingTasksCount } = await chrome.storage.local.get('pendingTasksCount');
    
    if (!pendingTasksCount || pendingTasksCount <= 0) {
        console.log('[GradescopeToCal] No pending tasks to process.');
        return;
    }
    
    console.log(`[GradescopeToCal] Pending sync! Need to process ${pendingTasksCount} tasks...`);
    console.time('[GradescopeToCal] ⏱️ FULL_PROCESSING_FLOW');
    
    await ensureTasksWindowOpen(pendingTasksCount);
    
    console.timeEnd('[GradescopeToCal] ⏱️ FULL_PROCESSING_FLOW');
    
    // Clear the flag after processing
    await chrome.storage.local.remove('pendingTasksCount');
    console.log('[GradescopeToCal] Cleared pending tasks count.');
}

async function ensureTasksWindowOpen(expectedCount) {
    // Check if tasks is open in any tab
    const existingTabs = await chrome.tabs.query({ url: "https://tasks.google.com/*" });
    
    if (existingTabs.length > 0) {
        console.log('[GradescopeToCal] Tasks tab already open, triggering processing...');
        console.time('[GradescopeToCal] ⏱️ TRIGGER_EXISTING_TAB');
        await triggerTasksProcessing(existingTabs[0].id); // Pass just ID
        
        // Also wait here if reusing existing tab
        await waitForTasksCompletion(expectedCount);

        console.timeEnd('[GradescopeToCal] ⏱️ TRIGGER_EXISTING_TAB');
        
        // Switch back to original calendar tab if we were the ones who triggered this flow
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab && currentTab.url.includes('calendar.google.com')) {
             // We are likely on the tasks tab now, switch back to calendar tab if found
             // But wait, currentTab might be the TASKS tab now. 
             // We want to find the calendar tab.
             const calendarTabs = await chrome.tabs.query({ url: "*://calendar.google.com/calendar/*" });
             if (calendarTabs.length > 0) {
                 await chrome.tabs.update(calendarTabs[0].id, { active: true });
             }
        }
    } else {
        // Create a NEW window (small popup)
        console.log('[GradescopeToCal] Opening Tasks popup for processing...');
        
        // Get current active tab (Calendar) to switch back to later
        const [calendarTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Create tiny popup window (Chrome enforces minimum ~150px)
        const tasksWindow = await chrome.windows.create({
            url: "https://tasks.google.com/tasks/",
            type: "popup",
            width: 150,
            height: 150,
            focused: false  // Don't steal focus
        });
        
        // The new window has one tab, get its ID
        const tasksTabId = tasksWindow.tabs[0].id; // width/height might need adjustments for content to render nicely
        
        // Wait for the tab to load and content script to run
        console.time('[GradescopeToCal] ⏱️ TAB_LOAD');
        await waitForTabLoad(tasksTabId);
        console.timeEnd('[GradescopeToCal] ⏱️ TAB_LOAD');
        console.log('[GradescopeToCal] Tasks tab loaded, waiting for processing...');
        
        // Set up the completion waiter
        await waitForTasksCompletion(expectedCount);
        
        // Switch back to original tab
        if (calendarTab && calendarTab.id) {
            console.log('[GradescopeToCal] Switching back to calendar tab...');
            // Since we opened a new window, focusing the old window/tab is needed
            await chrome.windows.update(calendarTab.windowId, { focused: true });
            await chrome.tabs.update(calendarTab.id, { active: true });
            
            // Optional: Close the tasks tab? 
            console.log('[GradescopeToCal] Cleaning up: Closing temporary Tasks popup...');
            await chrome.windows.remove(tasksWindow.id); 
        }
    }
}

function waitForTasksCompletion(count) {
    return new Promise((resolve) => {
        let processed = 0;
        let isResolved = false;
        
        // Timeout safety (fallback if script fails)
        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                console.log('[GradescopeToCal] ⚠️ Timed out waiting for tasks. Switching back anyway.');
                taskCompletionResolver = null;
                resolve();
            }
        }, 15000); // 15s max timeout (was 6s) 

        // Assign resolver to global variable so message listener can call it
        taskCompletionResolver = () => {
            processed++;
            console.log(`[GradescopeToCal] Progress: ${processed}/${count}`);
            if (processed >= count && !isResolved) {
                isResolved = true;
                clearTimeout(timeoutId);
                taskCompletionResolver = null;
                console.log('[GradescopeToCal] ✅ All tasks processed! Finishing immediately.');
                // Small buffer to ensure "Done" click registered and UI settles
                setTimeout(resolve, 300); 
            }
        };
    });
}

async function triggerTasksProcessing(tabId) {
    // Briefly focus the tasks tab
    console.log('[GradescopeToCal] Focusing tasks tab to trigger processing...');
    await chrome.tabs.update(tabId, { active: true });
}

function waitForTabLoad(tabId) {
    return new Promise((resolve) => {
        const listener = (id, changeInfo) => {
            if (id === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        // Timeout fallback
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, 10000);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    
    // Handle scraped assignments from content script
    if (message.action === 'assignmentsScraped') {
        const courseName = message.courseName || 'Gradescope';
        const currentUrl = sender.tab?.url || '';
        const now = Date.now();
        
        console.log(`[GradescopeToCal] 📥 Received ${message.data.length} assignments from ${courseName}`);
        
        chrome.storage.local.set({ 
            assignments: message.data,
            lastUpdated: now,
            courseUrl: currentUrl,
            courseName: courseName
        }, () => {
            console.log(`[GradescopeToCal] 💾 Stored ${message.data.length} assignments for ${courseName}`);
            sendResponse({ success: true });
            
            // Check debounce: skip if same URL synced recently or sync in progress
            if (isSyncing) {
                console.log('[GradescopeToCal] ⏸️ Sync already in progress, skipping...');
                return;
            }
            if (currentUrl === lastSyncUrl && (now - lastSyncTime) < SYNC_DEBOUNCE_MS) {
                console.log('[GradescopeToCal] ⏸️ Debounced: same page synced recently');
                return;
            }
            
            // Auto-sync to Google Tasks
            if (message.data.length > 0) {
                isSyncing = true;
                lastSyncUrl = currentUrl;
                lastSyncTime = now;
                
                console.log('[GradescopeToCal] 🔄 Auto-sync starting...');
                handleTasksSync(message.data, courseName)
                    .then(async (results) => {
                        console.log('[GradescopeToCal] ✅ Auto-sync API complete:', results);
                        
                        // Set pendingTasksCount so Calendar visit triggers time processing
                        if (results.success > 0) {
                            await chrome.storage.local.set({ pendingTasksCount: results.success });
                            console.log(`[GradescopeToCal] ⏰ Set pendingTasksCount=${results.success} - visit Calendar to process times`);
                        } else {
                            console.log('[GradescopeToCal] ℹ️ No new tasks created (all skipped/existing)');
                        }
                    })
                    .catch(err => {
                        console.log('[GradescopeToCal] ⚠️ Auto-sync failed:', err.message);
                    })
                    .finally(() => {
                        isSyncing = false;
                    });
            }
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

    // Handle task completion signal
    if (message.action === 'taskProcessed') {
        console.log('[GradescopeToCal] Received taskProcessed signal');
        if (taskCompletionResolver) {
            taskCompletionResolver();
        }
        return true; 
    }
    
    // Handle tasks sync request
    if (message.action === 'syncToTasks') {
        handleTasksSync(message.assignments)
            .then(async (results) => {
                // Set flag so next Calendar visit triggers time processing
                // Only if we actually created new tasks
                if (results.success > 0) {
                    await chrome.storage.local.set({ pendingTasksCount: results.success });
                    console.log('[GradescopeToCal] Set pendingTasksCount for', results.success, 'new tasks');
                }
                sendResponse({ success: true, results });
            })
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

async function handleTasksSync(assignments, courseName = 'Gradescope') {
    console.log(`[GradescopeToCal] Starting tasks sync for ${assignments.length} assignments (${courseName})`);
    
    if (!assignments || assignments.length === 0) {
        throw new Error('No assignments to sync');
    }
    
    const results = await self.tasksService.syncAssignmentsToTasks(assignments, courseName);
    
    console.log('[GradescopeToCal] Sync complete:', results);
    return results;
}

async function checkAuthentication() {
    try {
        const token = await self.tasksService.getAuthToken(false);
        return !!token;
    } catch {
        return false;
    }
}

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

console.log('[GradescopeToCal] Background service worker initialized with count-based processing');
