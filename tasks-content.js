(function() {
    /**
     * Google Tasks Content Script for GradescopeToCal
     * 
     * Runs on tasks.google.com
     * Includes "Visibility patch" to try and force rendering in background tabs.
     */

    console.log('[GradescopeToCal] 🚀 Tasks UI content script v5.1 loaded');
    console.time('[GradescopeToCal] ⏱️ TOTAL_INIT');
    
    // --- VISIBILITY OVERRIDE START ---
    // Try to trick the page into thinking it's visible so the SPA renders the list
    try {
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
        Object.defineProperty(document, 'hidden', { get: () => false });
        
        // Dispatch events to wake up the app
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('pageshow'));
        document.dispatchEvent(new Event('visibilitychange'));
        
        console.log('[GradescopeToCal] 👁️ Patched visibility state to force background rendering');
    } catch (e) {
        console.warn('[GradescopeToCal] Failed to patch visibility:', e);
    }
    // --- VISIBILITY OVERRIDE END ---

    const processedTasks = new Set();
    const EXTENSION_SIGNATURE = 'Created by GradescopeToCal';
    const DUE_TIME_PATTERN = /⏰\s*Due:.*?(\d{1,2}):(\d{2})\s*(AM|PM)/i;

    function calculateStartTime(notes) {
        const match = notes.match(DUE_TIME_PATTERN);
        if (!match) return null;
        
        let dueHours = parseInt(match[1], 10);
        const dueMinutes = parseInt(match[2], 10);
        const period = match[3]?.toUpperCase();
        
        if (period === 'PM' && dueHours < 12) dueHours += 12;
        else if (period === 'AM' && dueHours === 12) dueHours = 0;
        
        const dueDate = new Date();
        dueDate.setHours(dueHours, dueMinutes, 0, 0);
        
        const startDate = new Date(dueDate.getTime() - 30 * 60000); 
        
        return formatTime(startDate);
    }

    function formatTime(date) {
        let hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        if (hours === 0) hours = 12;
        return `${hours}:${String(minutes).padStart(2, '0')} ${ampm}`;
    }

    let isProcessing = false;

    async function findAndProcessTasks() {
        if (isProcessing) return;
        isProcessing = true;

        try {
            const isTasksDomain = window.location.hostname === 'tasks.google.com';
            const isCalendarTasks = window.location.href.includes('/tasks');
            const hasTaskSidebar = document.querySelector('div[role="main"]') || document.querySelector('div[role="list"]');
            
            if (!isTasksDomain && !isCalendarTasks && !hasTaskSidebar) {
                isProcessing = false;
                return;
            }

            // Force layout info if possible
            if (document.body) document.body.getBoundingClientRect();

            // Broad selector for task items
            const candidates = document.querySelectorAll('div[role="button"], div[role="listitem"], div[draggable="true"]');
            
                // Cold Start Safety: If we haven't processed anything yet, wait a bit for UI hydration
            if (processedTasks.size === 0 && candidates.length > 0) {
                console.log('[GradescopeToCal] ❄️ Cold start: Waiting 250ms for UI to settle...');
                await sleep(250);
            }
            
            for (const task of candidates) {
                // Check text content 
                if (!task.innerText || !task.innerText.includes(EXTENSION_SIGNATURE)) continue;
                
                const taskId = task.dataset.taskId || task.innerText.substring(0, 50);
                if (processedTasks.has(taskId)) continue;
                
                console.log('[GradescopeToCal] 🔍 Found Gradescope task:', taskId);
            
                // Ensure visible (fixes issues with long lists)
                task.scrollIntoView({ block: "center", behavior: "instant" });
            
                let dateChip = task.querySelector('div[aria-label^="Scheduled for"]');
                
                if (!dateChip) {
                    // Try clicking to expand if we are "background" and maybe simulated click helps?
                    console.log('[GradescopeToCal] Date chip not found, clicking to expand...');
                    task.click();
                    await sleep(350);
                    
                    dateChip = document.querySelector('div[aria-label^="Scheduled for"]');
                }
                
                if (!dateChip) {
                    // console.log('[GradescopeToCal] ❌ Still no date chip found.');
                    continue;
                }
                
                const label = dateChip.getAttribute('aria-label') || '';
                if (label.match(/\d{1,2}:\d{2}/)) {
                     console.log('[GradescopeToCal] ⏭️ Time already set (label: ' + label + '), skipping.');
                     processedTasks.add(taskId);
                     continue;
                }

                const activeContainer = task.closest('[role="listitem"]') || task;
                console.log(`[GradescopeToCal] 📝 Notes for ${taskId.substring(0, 20)}:`, activeContainer.innerText.split('\n').find(l => l.includes('Due')) || 'No Due line found');

                const timeToSet = calculateStartTime(activeContainer.innerText);
            
            if (!timeToSet) {
                 console.log('[GradescopeToCal] ⚠️ Could not parse Due Time from notes. Regex mismatch.');
                 continue;
            }
            
            console.log(`[GradescopeToCal] 🧮 Calculated Start Time: ${timeToSet}`);
            console.log(`[GradescopeToCal] ✏️ Setting time to ${timeToSet}...`);
            const timerId = `[GradescopeToCal] ⏱️ TIME_SET_${Date.now()}`;
            console.time(timerId);
            
            await performTimeSettingFlow(dateChip, timeToSet);
                
                console.timeEnd(timerId);
                processedTasks.add(taskId);
                
                // Notify background script that a task was processed
                chrome.runtime.sendMessage({ action: 'taskProcessed' });
                
                await sleep(150); 
            }
        } catch (e) {
            console.error('[GradescopeToCal] Error in loop:', e);
        } finally {
            isProcessing = false;
        }
    }

    async function performTimeSettingFlow(dateChip, timeString) {
        dateChip.click();
        await sleep(150);  // Relaxed from 50ms -> 75ms
        
        const timeInput = document.querySelector('input[aria-label="Set time"], input[placeholder="Set time"]');
        
        if (!timeInput) {
            console.log('[GradescopeToCal] ❌ "Set time" input not found in popup.');
            return;
        }
        
        console.log(`[GradescopeToCal] ⌨️ Typing time...`);
        timeInput.click();
        timeInput.focus();
        timeInput.select();

        const setTime = 60;
        
        timeInput.scrollIntoView({ block: "center", behavior: "instant" });
        document.execCommand('insertText', false, timeString);
        timeInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(setTime);
        
        timeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        
        await sleep(setTime);
        
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        const doneButton = buttons.find(b => b.innerText === 'Done' || b.textContent === 'Done');
        
        if (doneButton) {
            doneButton.click();
        } 
        
        await sleep(setTime);  // Relaxed from 20ms -> 40ms
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Run immediately on load, then poll faster
    setTimeout(findAndProcessTasks, 500);  // Start fast
    setInterval(findAndProcessTasks, 1500);  // Poll every 1.5s instead of 3s

})(); // End IIFE
