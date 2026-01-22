/**
 * Google Tasks Integration for GradescopeToCal
 * 
 * Handles OAuth2 authentication and task creation.
 * Uses launchWebAuthFlow as primary method (works without Chrome sync).
 * 
 * NOTE: Google Tasks API only stores dates, not times. 
 * The time is included in the task notes instead.
 */

const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';
const CLIENT_ID = '1021365920101-u8c5oe6hd4ogcumtjqbfgg3d22l62a1t.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/tasks';

// Storage key for the access token
const TOKEN_KEY = 'google_access_token';
const TOKEN_EXPIRY_KEY = 'google_token_expiry';

/**
 * Get OAuth2 access token using launchWebAuthFlow
 * @param {boolean} interactive - Whether to show login prompt
 * @returns {Promise<string>} Access token
 */
async function getAuthToken(interactive = true) {
    const cached = await getCachedToken();
    if (cached) {
        return cached;
    }
    
    if (!interactive) {
        throw new Error('No cached token and interactive mode disabled');
    }
    
    const redirectUrl = chrome.identity.getRedirectURL();
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUrl);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('prompt', 'consent');
    
    return new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
            { url: authUrl.toString(), interactive: true },
            (responseUrl) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                
                if (!responseUrl) {
                    reject(new Error('No response URL received'));
                    return;
                }
                
                try {
                    const url = new URL(responseUrl);
                    const hashParams = new URLSearchParams(url.hash.substring(1));
                    const accessToken = hashParams.get('access_token');
                    const expiresIn = hashParams.get('expires_in');
                    
                    if (!accessToken) {
                        reject(new Error('No access token in response'));
                        return;
                    }
                    
                    const expiryTime = Date.now() + (parseInt(expiresIn || '3600') * 1000);
                    chrome.storage.local.set({
                        [TOKEN_KEY]: accessToken,
                        [TOKEN_EXPIRY_KEY]: expiryTime
                    });
                    
                    resolve(accessToken);
                } catch (err) {
                    reject(new Error('Failed to parse auth response: ' + err.message));
                }
            }
        );
    });
}

/**
 * Get cached token if still valid
 */
async function getCachedToken() {
    return new Promise((resolve) => {
        chrome.storage.local.get([TOKEN_KEY, TOKEN_EXPIRY_KEY], (result) => {
            const token = result[TOKEN_KEY];
            const expiry = result[TOKEN_EXPIRY_KEY];
            
            if (token && expiry && Date.now() < expiry - 300000) {
                resolve(token);
            } else {
                resolve(null);
            }
        });
    });
}

/**
 * Remove cached auth token
 */
async function removeCachedToken() {
    return new Promise((resolve) => {
        chrome.storage.local.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY], () => {
            resolve();
        });
    });
}

/**
 * Check if the assignment name is just a due date (like "Due 1/23")
 * @param {string} name - Assignment name
 * @returns {boolean} True if name is a date-like pattern
 */
function isDateOnlyName(name) {
    // Matches patterns like "Due 1/23", "Due 01/23", "Due Jan 23", etc.
    const datePatterns = [
        /^Due\s+\d{1,2}\/\d{1,2}/i,       // Due 1/23
        /^Due\s+\d{1,2}-\d{1,2}/i,         // Due 1-23
        /^Due\s+[A-Za-z]+\s+\d{1,2}/i,     // Due Jan 23
        /^\d{1,2}\/\d{1,2}/,               // 1/23
        /^Assignment\s+\d+$/i,             // Assignment 1
        /^HW\s*\d+$/i,                     // HW1, HW 1
    ];
    
    return datePatterns.some(pattern => pattern.test(name.trim()));
}

/**
 * Generate a proper task title based on assignment name and course
 * @param {Object} assignment - Assignment object
 * @param {string} courseName - Course name (e.g., "MATH 241")
 * @returns {string} Formatted task title
 */
function formatTaskTitle(assignment, courseName = 'MATH 241') {
    const name = assignment.name.trim();
    
    // If the name is just a due date pattern, use courseName + "Assignment"
    if (isDateOnlyName(name)) {
        return `📚 ${courseName} Assignment`;
    }
    
    // Otherwise use the actual assignment name
    return `📚 ${name}`;
}

/**
 * Format the due date for Google Tasks API
 * Google Tasks only supports date (not time), so we use YYYY-MM-DD format
 * 
 * IMPORTANT: We need to use the local date, not UTC, to avoid date shifting
 * 
 * @param {string} rawDate - ISO date string
 * @returns {string} Date in YYYY-MM-DD format
 */
function formatDueDate(rawDate) {
    const date = new Date(rawDate);
    
    // Use local date components to avoid timezone shifting
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}T00:00:00.000Z`;
}

/**
 * Format the time for display in notes
 * @param {string} rawDate - ISO date string
 * @returns {string} Formatted time string (e.g., "10:00 PM")
 */
function formatDueTime(rawDate) {
    const date = new Date(rawDate);
    return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

/**
 * Format full date for notes
 * @param {string} rawDate - ISO date string
 * @returns {string} Formatted date string
 */
function formatFullDate(rawDate) {
    const date = new Date(rawDate);
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
}

/**
 * Get or create a task list for Gradescope assignments
 */
async function getOrCreateTaskList(token) {
    const listTitle = 'Gradescope Assignments';
    
    const listsResponse = await fetch(`${TASKS_API_BASE}/users/@me/lists`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (listsResponse.ok) {
        const listsData = await listsResponse.json();
        const existingList = listsData.items?.find(list => list.title === listTitle);
        if (existingList) {
            return existingList.id;
        }
    }
    
    const createResponse = await fetch(`${TASKS_API_BASE}/users/@me/lists`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title: listTitle })
    });
    
    if (!createResponse.ok) {
        throw new Error('Failed to create task list');
    }
    
    const newList = await createResponse.json();
    return newList.id;
}

/**
 * Create a Google Task for an assignment
 */
async function createTask(token, listId, assignment, courseName = 'MATH 241') {
    const title = formatTaskTitle(assignment, courseName);
    const dueDate = formatDueDate(assignment.rawDate);
    const dueTime = formatDueTime(assignment.rawDate);
    const fullDate = formatFullDate(assignment.rawDate);
    
    // Build detailed notes since API doesn't support due time
    const notes = [
        `⏰ Due: ${fullDate} at ${dueTime}`,
        `📊 Status: ${assignment.status}`,
        `📝 Original name: ${assignment.name}`,
        '',
        'Created by GradescopeToCal Extension'
    ].join('\n');
    
    const task = {
        title: title,
        notes: notes,
        due: dueDate
    };
    
    const response = await fetch(`${TASKS_API_BASE}/lists/${listId}/tasks`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(task)
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to create task');
    }
    
    return response.json();
}

/**
 * Check if a task for this assignment already exists
 */
async function taskExists(token, listId, assignment, courseName = 'MATH 241') {
    const response = await fetch(
        `${TASKS_API_BASE}/lists/${listId}/tasks?showCompleted=true&showHidden=true`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    if (!response.ok) {
        return false;
    }
    
    const data = await response.json();
    const searchTitle = formatTaskTitle(assignment, courseName);
    
    // Also check if original name is in notes (for duplicates)
    return data.items?.some(task => {
        if (task.title === searchTitle) {
            // Check notes for original name to avoid duplicates
            return task.notes?.includes(assignment.name);
        }
        return false;
    }) || false;
}

/**
 * Sync all assignments to Google Tasks
 */
async function syncAssignmentsToTasks(assignments, courseName = 'MATH 241') {
    const results = {
        success: 0,
        skipped: 0,
        failed: 0,
        errors: []
    };
    
    try {
        const token = await getAuthToken(true);
        const listId = await getOrCreateTaskList(token);
        
        console.log('[Tasks] Using task list:', listId);
        
        for (const assignment of assignments) {
            if (!assignment.rawDate) {
                results.skipped++;
                continue;
            }
            
            try {
                const exists = await taskExists(token, listId, assignment, courseName);
                if (exists) {
                    console.log(`[Tasks] Skipping existing: ${assignment.name}`);
                    results.skipped++;
                    continue;
                }
                
                await createTask(token, listId, assignment, courseName);
                console.log(`[Tasks] Created: ${assignment.name}`);
                results.success++;
                
            } catch (err) {
                console.error(`[Tasks] Failed: ${assignment.name}:`, err);
                results.failed++;
                results.errors.push(`${assignment.name}: ${err.message}`);
            }
        }
        
    } catch (err) {
        console.error('[Tasks] Auth failed:', err);
        throw new Error('Authentication failed: ' + err.message);
    }
    
    return results;
}

// Export for background.js
if (typeof self !== 'undefined') {
    self.tasksService = {
        getAuthToken,
        removeCachedToken,
        formatTaskTitle,
        createTask,
        syncAssignmentsToTasks
    };
}
