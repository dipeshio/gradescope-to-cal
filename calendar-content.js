(function() {
    /**
     * Calendar Content Script for GradescopeToCal
     * 
     * Runs on calendar.google.com to automatically add time to tasks.
     * EXCLUDES the /tasks view which is handled by tasks-content.js
     */

    if (window.location.href.includes('/tasks')) {
        console.log('[GradescopeToCal] 🛑 Calendar script skipping /tasks view');
        return;
    }

    console.log('[GradescopeToCal] 🚀 Calendar content script loaded');

    const processedTasks = new Set();
    const EXTENSION_SIGNATURE = 'Created by GradescopeToCal';
    const DUE_TIME_PATTERN = /⏰\s*Due:\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i;

    function calculateTaskTimes(notes) {
        const match = notes.match(DUE_TIME_PATTERN);
        if (!match) return null;
        
        let dueHours = parseInt(match[1], 10);
        const dueMinutes = parseInt(match[2], 10);
        const period = match[3]?.toUpperCase();
        
        if (period === 'PM' && dueHours < 12) dueHours += 12;
        else if (period === 'AM' && dueHours === 12) dueHours = 0;
        
        const dueDate = new Date();
        dueDate.setHours(dueHours, dueMinutes, 0, 0);
        
        // Calculate offsets
        const endDate = new Date(dueDate.getTime() - 15 * 60000); 
        const startDate = new Date(dueDate.getTime() - 30 * 60000); 
        
        return {
            start: formatTime(startDate),
            end: formatTime(endDate)
        };
    }

    /**
     * Format Date object to "hh:mm AM/PM" string
     */
    function formatTime(date) {
        let hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        
        hours = hours % 12;
        if (hours === 0) hours = 12; 
        
        return `${hours}:${String(minutes).padStart(2, '0')} ${ampm}`;
    }

    function isOurTask(popup) {
        const descDiv = popup.querySelector('#xDetDlgDesc') || popup;
        return (descDiv.textContent || popup.textContent || '').includes(EXTENSION_SIGNATURE);
    }

    function getTimesFromPopup(popup) {
        const descDiv = popup.querySelector('#xDetDlgDesc') || popup;
        return calculateTaskTimes(descDiv.textContent || popup.textContent || '');
    }

    function hasTimeSet(popup) {
        const buttons = popup.querySelectorAll('button');
        for (const btn of buttons) {
            if (btn.textContent?.includes('Add time')) {
                return false; 
            }
        }
        return true; 
    }

    async function clickAddTimeButton(popup) {
        const buttons = popup.querySelectorAll('button');
        for (const btn of buttons) {
            const spans = btn.querySelectorAll('span');
            for (const span of spans) {
                if (span.textContent?.toLowerCase() === 'add time') {
                    console.log('[GradescopeToCal] ✅ Found "Add time" button, clicking...');
                    btn.click();
                    await sleep(800);
                    return true;
                }
            }
            if (btn.textContent?.toLowerCase().includes('add time')) {
                console.log('[GradescopeToCal] ✅ Found "Add time" button (text), clicking...');
                btn.click();
                await sleep(800);
                return true;
            }
        }
        return false;
    }

    async function ensureInputVisible(input, name) {
        if (!input) return false;
        
        const rect = input.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            return true;
        }
        
        console.log(`[GradescopeToCal] ${name} input hidden, clicking container...`);
        if (input.parentElement) {
            input.parentElement.click();
            await sleep(300);
        }
        
        const rectAfter = input.getBoundingClientRect();
        if (rectAfter.width > 0) return true;
        
        if (input.parentElement && input.parentElement.parentElement) {
            input.parentElement.parentElement.click();
            await sleep(300);
        }
        
        return input.getBoundingClientRect().width > 0;
    }

    async function setInputValue(selector, value, name) {
        let input = document.querySelector(selector);
        if (!input) return false;
        
        const visible = await ensureInputVisible(input, name);
        if (!visible) return false;
        
        input = document.querySelector(selector);
        
        console.log(`[GradescopeToCal] Setting ${name} to: ${value}`);
        try {
            input.focus();
            input.select();
            document.execCommand('insertText', false, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.blur();
            await sleep(400); 
            return true;
        } catch (e) {
            console.warn(`[GradescopeToCal] Error setting ${name}:`, e);
            return false;
        }
    }

    async function fillTimeInPicker(times) {
        const { start, end } = times;
        const startMoved = await setInputValue('input[aria-label="Start time"]', start, "Start Time");
        if (!startMoved) return false;
        
        const endMoved = await setInputValue('input[aria-label="End time"]', end, "End Time");
        return startMoved && endMoved;
    }

    async function clickSaveButton() {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            if (btn.textContent?.trim() === 'Save') {
                btn.click();
                return true;
            }
        }
        const saveBtn = document.querySelector('[aria-label="Save"]');
        if (saveBtn) {
            saveBtn.click();
            return true;
        }
        return false;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function processPopup(popup) {
        const popupId = popup.id || (popup.className + (popup.textContent?.substring(0, 30) || ''));
        if (processedTasks.has(popupId)) return;
        
        if (!isOurTask(popup)) return;
        
        const times = getTimesFromPopup(popup);
        if (!times) return;
        
        if (hasTimeSet(popup)) {
            processedTasks.add(popupId);
            return;
        }
        
        processedTasks.add(popupId);
        
        await clickAddTimeButton(popup);
        await sleep(500); 
        
        const filled = await fillTimeInPicker(times);
        if (filled) {
            await clickSaveButton();
            console.log('[GradescopeToCal] ✅ Successfully set time range on task!');
        }
    }

    function startWatching() {
        console.log('[GradescopeToCal] 👀 Starting popup watcher...');
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    if (node.matches?.('[role="dialog"]') || node.classList?.contains('RDlrG')) {
                        setTimeout(() => processPopup(node), 500);
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startWatching);
    } else {
        startWatching();
    }

    document.addEventListener('click', async () => {
        await sleep(800);
        const dialogs = document.querySelectorAll('[role="dialog"], .RDlrG');
        for (const dialog of dialogs) {
            if (dialog.offsetParent !== null) {
                processPopup(dialog);
            }
        }
    }, true);

})(); // End IIFE
