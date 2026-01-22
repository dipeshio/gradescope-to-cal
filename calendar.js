/**
 * Google Tasks Integration for GradescopeToCal
 * 
 * Handles OAuth2 authentication and task creation.
 * Time is stored in notes for the calendar-content.js to parse and apply.
 */

const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';
const CLIENT_ID = '1021365920101-u8c5oe6hd4ogcumtjqbfgg3d22l62a1t.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/tasks';

const TOKEN_KEY = 'google_access_token';
const TOKEN_EXPIRY_KEY = 'google_token_expiry';

/**
 * Get OAuth2 access token using launchWebAuthFlow
 */
async function getAuthToken(interactive = true) {
    const cached = await getCachedToken();
    if (cached) return cached;
    
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

async function removeCachedToken() {
    return new Promise((resolve) => {
        chrome.storage.local.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY], () => resolve());
    });
}

/**
 * Check if assignment name is just a due date
 */
function isDateOnlyName(name) {
    const datePatterns = [
        /^Due\s+\d{1,2}\/\d{1,2}/i,
        /^Due\s+\d{1,2}-\d{1,2}/i,
        /^Due\s+[A-Za-z]+\s+\d{1,2}/i,
        /^\d{1,2}\/\d{1,2}/,
        /^Assignment\s+\d+$/i,
        /^HW\s*\d+$/i,
    ];
    return datePatterns.some(pattern => pattern.test(name.trim()));
}

/**
 * Generate task title
 */
function formatTaskTitle(assignment, courseName = 'MATH 241') {
    const name = assignment.name.trim();
    if (isDateOnlyName(name)) {
        return `📚 ${courseName} Assignment`;
    }
    return `📚 ${name}`;
}

/**
 * Parse due date and time
 */
function parseDueDateTime(rawDate) {
    const date = new Date(rawDate);
    
    // Check for 11:59 PM -> adjust to 11:45 PM
    let hours = date.getHours();
    let minutes = date.getMinutes();
    
    if (hours === 23 && minutes === 59) {
        hours = 23;
        minutes = 45;
    }
    
    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hours,
        minutes,
        // Format for notes (12hr)
        timeStr: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        // Format for API (date only)
        dateStr: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T00:00:00.000Z`
    };
}

/**
 * Get or create task list
 */
async function getOrCreateTaskList(token) {
    const listTitle = 'Gradescope Assignments';
    
    const listsResponse = await fetch(`${TASKS_API_BASE}/users/@me/lists`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (listsResponse.ok) {
        const listsData = await listsResponse.json();
        const existingList = listsData.items?.find(list => list.title === listTitle);
        if (existingList) return existingList.id;
    }
    
    const createResponse = await fetch(`${TASKS_API_BASE}/users/@me/lists`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title: listTitle })
    });
    
    if (!createResponse.ok) throw new Error('Failed to create task list');
    const newList = await createResponse.json();
    return newList.id;
}

/**
 * Create task with time info in notes
 * The calendar-content.js will parse this and auto-fill the time
 */
async function createTask(token, listId, assignment, courseName) {
    const title = formatTaskTitle(assignment, courseName);
    const dt = parseDueDateTime(assignment.rawDate);
    
    // Notes include time in a format our calendar script can parse
    const notes = [
        `⏰ Due: ${dt.timeStr}`,
        `📊 Status: ${assignment.status}`,
        `📝 Original: ${assignment.name}`,
        '',
        'Created by GradescopeToCal'
    ].join('\n');
    
    const task = {
        title: title,
        notes: notes,
        due: dt.dateStr
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
 * Check if task already exists
 */
async function taskExists(token, listId, assignment, courseName) {
    const response = await fetch(
        `${TASKS_API_BASE}/lists/${listId}/tasks?showCompleted=true&showHidden=true`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    if (!response.ok) return false;
    
    const data = await response.json();
    const searchTitle = formatTaskTitle(assignment, courseName);
    
    return data.items?.some(task => {
        if (task.title === searchTitle) {
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
