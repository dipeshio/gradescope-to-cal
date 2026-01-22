/**
 * Popup Script for GradescopeToCal Extension
 * 
 * Handles:
 * - Loading assignments from chrome.storage
 * - Rendering assignments in the popup table
 * - Refresh functionality to trigger re-scraping
 * - Google Tasks sync functionality
 * - Status-based styling for assignments
 */

// Store assignments globally for sync
let currentAssignments = [];

document.addEventListener('DOMContentLoaded', () => {
    loadAssignments();
    setupEventListeners();
});

/**
 * Set up event listeners for UI interactions
 */
function setupEventListeners() {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', handleRefresh);
    }
    
    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) {
        syncBtn.addEventListener('click', handleSync);
    }
}

/**
 * Load assignments from storage and display them
 */
async function loadAssignments() {
    showLoading(true);
    
    try {
        const result = await chrome.storage.local.get(['assignments', 'lastUpdated', 'courseUrl']);
        
        if (result.assignments && result.assignments.length > 0) {
            currentAssignments = result.assignments;
            renderAssignments(result.assignments);
            updateLastUpdated(result.lastUpdated);
            showEmptyState(false);
            enableSyncButton(true);
        } else {
            currentAssignments = [];
            showEmptyState(true);
            enableSyncButton(false);
        }
    } catch (error) {
        console.error('[GradescopeToCal] Error loading assignments:', error);
        showStatus('Error loading assignments', 'error');
        showEmptyState(true);
        enableSyncButton(false);
    } finally {
        showLoading(false);
    }
}

/**
 * Handle refresh button click - trigger scraping on active tab
 */
async function handleRefresh() {
    showStatus('Refreshing...', 'info');
    
    try {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Allow both Gradescope and localhost for testing
        const isGradescope = tab.url.includes('gradescope.com/courses');
        const isLocalTest = tab.url.includes('localhost:8000') || tab.url.includes('127.0.0.1:8000');
        
        if (!tab.url || (!isGradescope && !isLocalTest)) {
            showStatus('Please navigate to a Gradescope course page', 'warning');
            return;
        }
        
        // Send message to content script to scrape
        await chrome.tabs.sendMessage(tab.id, { action: 'scrapeAssignments' });
        
        // Wait a moment for storage to update, then reload
        setTimeout(() => {
            loadAssignments();
            showStatus('Refreshed successfully', 'success');
        }, 1500);
        
    } catch (error) {
        console.error('[GradescopeToCal] Refresh error:', error);
        showStatus('Could not refresh. Try reloading the Gradescope page.', 'error');
    }
}

/**
 * Handle sync button click - sync assignments to Google Tasks
 */
async function handleSync() {
    if (currentAssignments.length === 0) {
        showStatus('No assignments to sync', 'warning');
        return;
    }
    
    const syncBtn = document.getElementById('syncBtn');
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';
    
    showStatus('Connecting to Google Tasks...', 'info');
    
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'syncToTasks',
            assignments: currentAssignments
        });
        
        if (response.success) {
            const { success, skipped, failed } = response.results;
            let message = `Synced! ${success} added`;
            if (skipped > 0) message += `, ${skipped} skipped`;
            if (failed > 0) message += `, ${failed} failed`;
            
            showStatus(message, failed > 0 ? 'warning' : 'success');
        } else {
            throw new Error(response.error || 'Sync failed');
        }
        
    } catch (error) {
        console.error('[GradescopeToCal] Sync error:', error);
        showStatus(`Sync failed: ${error.message}`, 'error');
    } finally {
        syncBtn.disabled = false;
        syncBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 11L12 14L22 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M21 12V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V5C3 3.9 3.9 3 5 3H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Sync to Tasks
        `;
    }
}

/**
 * Enable or disable the sync button
 * @param {boolean} enabled - Whether to enable the button
 */
function enableSyncButton(enabled) {
    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) {
        syncBtn.disabled = !enabled;
    }
}

/**
 * Render assignments in the table
 * @param {Array<Object>} assignments - Array of assignment objects
 */
function renderAssignments(assignments) {
    const tbody = document.getElementById('assignmentBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    assignments.forEach(assignment => {
        const row = document.createElement('tr');
        row.className = 'assignment-row';
        
        // Assignment name cell
        const nameCell = document.createElement('td');
        nameCell.className = 'cell-name';
        nameCell.textContent = assignment.name;
        nameCell.title = assignment.name; // Tooltip for long names
        
        // Due date cell
        const dateCell = document.createElement('td');
        dateCell.className = 'cell-date';
        dateCell.textContent = formatDueDate(assignment.dueDate, assignment.rawDate);
        
        // Status cell
        const statusCell = document.createElement('td');
        statusCell.className = 'cell-status';
        
        const statusBadge = document.createElement('span');
        statusBadge.className = `status-badge status-${assignment.statusType || 'default'}`;
        statusBadge.textContent = assignment.status;
        statusCell.appendChild(statusBadge);
        
        row.appendChild(nameCell);
        row.appendChild(dateCell);
        row.appendChild(statusCell);
        
        tbody.appendChild(row);
    });
}

/**
 * Format due date for display
 * @param {string} dueDate - Human-readable due date
 * @param {string} rawDate - Machine-readable datetime string
 * @returns {string} Formatted date string
 */
function formatDueDate(dueDate, rawDate) {
    if (dueDate) {
        return dueDate;
    }
    
    if (rawDate) {
        try {
            const date = new Date(rawDate);
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
            });
        } catch (e) {
            return rawDate;
        }
    }
    
    return 'No due date';
}

/**
 * Update the last updated timestamp display
 * @param {number} timestamp - Unix timestamp in milliseconds
 */
function updateLastUpdated(timestamp) {
    const element = document.getElementById('lastUpdated');
    if (!element || !timestamp) return;
    
    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit'
    });
    element.textContent = `Updated at ${timeStr}`;
}

/**
 * Show or hide the loading state
 * @param {boolean} show - Whether to show the loading state
 */
function showLoading(show) {
    const loadingState = document.getElementById('loadingState');
    const tableContainer = document.querySelector('.table-container');
    
    if (loadingState) {
        loadingState.classList.toggle('hidden', !show);
    }
    if (tableContainer) {
        tableContainer.classList.toggle('hidden', show);
    }
}

/**
 * Show or hide the empty state
 * @param {boolean} show - Whether to show the empty state
 */
function showEmptyState(show) {
    const emptyState = document.getElementById('emptyState');
    const tableContainer = document.querySelector('.table-container');
    
    if (emptyState) {
        emptyState.classList.toggle('hidden', !show);
    }
    if (tableContainer) {
        tableContainer.classList.toggle('hidden', show);
    }
}

/**
 * Show a status message
 * @param {string} message - The message to display
 * @param {string} type - Message type: 'success', 'error', 'warning', 'info'
 */
function showStatus(message, type = 'info') {
    const statusBar = document.getElementById('status');
    if (!statusBar) return;
    
    statusBar.textContent = message;
    statusBar.className = `status-bar status-${type}`;
    statusBar.classList.remove('hidden');
    
    // Auto-hide after 4 seconds for sync messages
    setTimeout(() => {
        statusBar.classList.add('hidden');
    }, 4000);
}
