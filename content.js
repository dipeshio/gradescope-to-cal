/**
 * Content Script for GradescopeToCal Extension
 * 
 * This script runs on Gradescope course pages and handles:
 * - Autonomous detection and scraping of assignment data
 * - Extracting assignment names, due dates, and statuses
 * - Sending data to background script for storage
 * 
 * DOM Selectors used (based on Gradescope's structure):
 * - Assignment rows: #assignments-student-table tbody tr (with .odd or .even classes)
 * - Assignment name: .js-submitAssignment button or th[scope="row"]
 * - Due date: .submissionTimeChart--dueDate (datetime attribute)
 * - Status: .submissionStatus--text
 */

/**
 * Scrapes all assignments from the current Gradescope course page
 * @returns {Array<Object>} Array of assignment objects with name, dueDate, status, and rawDate
 */
function scrapeAssignments() {
    const assignments = [];
    
    try {
        // Find the assignment table - Gradescope uses id="assignments-student-table"
        const assignmentTable = document.querySelector('#assignments-student-table');
        
        if (!assignmentTable) {
            console.warn('[GradescopeToCal] Assignment table not found on this page');
            return assignments;
        }
        
        // Get all assignment rows (they have .odd or .even classes)
        const rows = assignmentTable.querySelectorAll('tbody tr.odd, tbody tr.even');
        
        if (rows.length === 0) {
            console.warn('[GradescopeToCal] No assignment rows found');
            return assignments;
        }
        
        rows.forEach((row, index) => {
            try {
                const assignment = extractAssignmentData(row);
                if (assignment) {
                    assignment.id = index;
                    assignments.push(assignment);
                }
            } catch (err) {
                console.error('[GradescopeToCal] Error extracting row', index, ':', err.message);
            }
        });
        
        console.log('[GradescopeToCal] Successfully scraped', assignments.length, 'assignments');
        
    } catch (err) {
        console.error('[GradescopeToCal] Error during scraping:', err.message);
    }
    
    return assignments;
}

/**
 * Extracts assignment data from a single table row
 * @param {HTMLElement} row - The table row element
 * @returns {Object|null} Assignment object or null if extraction fails
 */
function extractAssignmentData(row) {
    // Extract assignment name
    // Primary selector: button with .js-submitAssignment class
    // Fallback: any button or link in the first cell
    let name = '';
    const nameButton = row.querySelector('.js-submitAssignment');
    if (nameButton) {
        name = nameButton.textContent.trim();
    } else {
        // Fallback to first th or td content
        const firstCell = row.querySelector('th, td');
        if (firstCell) {
            name = firstCell.textContent.trim();
        }
    }
    
    if (!name) {
        console.warn('[GradescopeToCal] Could not extract assignment name');
        return null;
    }
    
    // Extract due date
    // The datetime attribute contains the machine-readable date
    let dueDate = '';
    let rawDate = '';
    const dueDateElement = row.querySelector('.submissionTimeChart--dueDate');
    if (dueDateElement) {
        rawDate = dueDateElement.getAttribute('datetime') || '';
        dueDate = dueDateElement.textContent.trim();
    } else {
        // Fallback: look for any time element
        const timeElement = row.querySelector('time[datetime]');
        if (timeElement) {
            rawDate = timeElement.getAttribute('datetime') || '';
            dueDate = timeElement.textContent.trim();
        }
    }
    
    // Extract status
    // Look for the status text element
    let status = 'Unknown';
    const statusElement = row.querySelector('.submissionStatus--text');
    if (statusElement) {
        status = statusElement.textContent.trim();
    } else {
        // Fallback: check for status class on parent
        const statusContainer = row.querySelector('.submissionStatus');
        if (statusContainer) {
            // Try to infer status from class names
            if (statusContainer.classList.contains('submissionStatus-success')) {
                status = 'Submitted';
            } else if (statusContainer.classList.contains('submissionStatus-warning')) {
                status = 'No Submission';
            } else if (statusContainer.classList.contains('submissionStatus-error')) {
                status = 'Missing';
            }
        }
    }
    
    // Determine status type for styling
    const statusType = getStatusType(status);
    
    return {
        name,
        dueDate,
        rawDate,
        status,
        statusType
    };
}

/**
 * Determines the status type for UI styling
 * @param {string} status - The status text
 * @returns {string} Status type: 'success', 'warning', 'error', 'info', or 'default'
 */
function getStatusType(status) {
    const statusLower = status.toLowerCase();
    
    if (statusLower.includes('submitted') || statusLower.includes('graded')) {
        return 'success';
    }
    if (statusLower.includes('late') || statusLower.includes('missing')) {
        return 'error';
    }
    if (statusLower.includes('no submission') || statusLower.includes('incomplete') || statusLower.includes('not started')) {
        return 'warning';
    }
    if (statusLower.includes('locked')) {
        return 'info';
    }
    
    return 'default';
}

/**
 * Sends scraped assignments to the background script for storage
 * @param {Array<Object>} assignments - Array of assignment objects
 */
function sendToBackground(assignments) {
    chrome.runtime.sendMessage({
        action: 'assignmentsScraped',
        data: assignments
    }).then(response => {
        if (response?.success) {
            console.log('[GradescopeToCal] Assignments sent to background successfully');
        }
    }).catch(err => {
        console.error('[GradescopeToCal] Failed to send to background:', err.message);
    });
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'scrapeAssignments') {
        const assignments = scrapeAssignments();
        sendToBackground(assignments);
        sendResponse({ success: true, count: assignments.length });
    }
    return true;
});

// Auto-scrape when the content script loads
(function init() {
    // Wait a moment for the page to fully render
    setTimeout(() => {
        console.log('[GradescopeToCal] Content script initialized, starting auto-scrape...');
        const assignments = scrapeAssignments();
        if (assignments.length > 0) {
            sendToBackground(assignments);
        }
    }, 1000);
})();
