from datetime import datetime, timedelta

def generate_row(id, title, due_date, status_class, status_text):
    date_str = due_date.strftime("%b %d at %-I:%M%p")
    iso_date = due_date.strftime("%Y-%m-%d %H:%M:%S %z")
    
    return f"""
                <!-- Assignment {id}: {title} -->
                <tr role="row" class="odd">
                    <th class="table--primaryLink" role="rowheader" scope="row">
                        <button class="js-submitAssignment" 
                                data-assignment-id="{id}" 
                                data-assignment-title="{title}"
                                aria-label="Submit {title}">
                            {title}
                        </button>
                    </th>
                    <td class="submissionStatus {status_class}">
                        <div class="submissionStatus--bullet" aria-hidden="true"></div>
                        <div class="submissionStatus--text">{status_text}</div>
                    </td>
                    <td>
                        <div class="submissionTimeChart">
                            <time class="submissionTimeChart--dueDate" 
                                  datetime="{iso_date}"
                                  aria-label="Due at {date_str}">
                                {date_str}
                            </time>
                        </div>
                    </td>
                </tr>
"""

start_date = datetime(2026, 1, 22, 12, 0) # Jan 22, 12:00 PM
assignments = []

for day in range(5):
    current_day = start_date + timedelta(days=day)
    for task_num in range(3):
        due_time = current_day + timedelta(hours=task_num * 2)
        
        # Mix up statuses
        status_class = "submissionStatus-warning" 
        status_text = "Not Submitted"
        if task_num == 0:
            status_class = "submissionStatus-success"
            status_text = "Submitted"
            
        title = f"Day {day+1} Task {task_num+1} ({due_time.strftime('%I%p')})"
        assign_id = 2000 + (day * 3) + task_num
        
        assignments.append(generate_row(assign_id, title, due_time, status_class, status_text))

html = "".join(assignments)
print(html)
