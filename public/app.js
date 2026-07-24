// DOM Elements
const configForm = document.getElementById('config-form');
const targetUrlInput = document.getElementById('targetUrl');
const totalVisitsInput = document.getElementById('totalVisits');
const concurrencyInput = document.getElementById('concurrency');
const minDwellTimeInput = document.getElementById('minDwellTime');
const maxDwellTimeInput = document.getElementById('maxDwellTime');
const headlessCheckbox = document.getElementById('headless');
const proxiesInput = document.getElementById('proxies');

const startBtn = document.getElementById('start-btn');
const pauseBtn = document.getElementById('pause-btn');
const stopBtn = document.getElementById('stop-btn');

const statusBadge = document.getElementById('status-badge');
const progressFill = document.getElementById('progress-fill');
const progressPercent = document.getElementById('progress-percent');
const progressFraction = document.getElementById('progress-fraction');

const completedMetric = document.getElementById('metric-completed');
const failedMetric = document.getElementById('metric-failed');
const activeMetric = document.getElementById('metric-active');
const timeMetric = document.getElementById('metric-time');

const logConsole = document.getElementById('log-console');

let eventSource = null;
let currentConfig = null;

// Initialize SSE Stream
function connectStream() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/stream');

  eventSource.addEventListener('config', (e) => {
    const config = JSON.parse(e.data);
    currentConfig = config;
    updateConfigForm(config);
    // Enable start button once configured
    if (config.targetUrl) {
      startBtn.removeAttribute('disabled');
    }
  });

  eventSource.addEventListener('stats', (e) => {
    const stats = JSON.parse(e.data);
    updateDashboard(stats);
  });

  eventSource.addEventListener('log', (e) => {
    const log = JSON.parse(e.data);
    appendLog(log);
  });

  eventSource.onerror = (err) => {
    console.error('SSE Error:', err);
    appendLog({
      timestamp: new Date().toLocaleTimeString(),
      message: 'Connection to server lost. Retrying...',
      type: 'warning'
    });
  };
}

// Update form with current config
function updateConfigForm(config) {
  targetUrlInput.value = config.targetUrl || '';
  totalVisitsInput.value = config.totalVisits;
  concurrencyInput.value = config.concurrency;
  minDwellTimeInput.value = config.minDwellTime;
  maxDwellTimeInput.value = config.maxDwellTime;
  headlessCheckbox.checked = config.headless;
  proxiesInput.value = config.proxies ? config.proxies.join('\n') : '';

  // Set checkbox values for referrers
  const checkboxes = document.querySelectorAll('input[name="referrers"]');
  checkboxes.forEach(cb => {
    cb.checked = config.referrers.includes(cb.value);
  });
}

// Update dashboard with real-time stats
function updateDashboard(stats) {
  // Update status badge
  statusBadge.className = `badge ${stats.status}`;
  statusBadge.textContent = stats.status;

  // Update metrics
  completedMetric.textContent = stats.visitsCompleted;
  failedMetric.textContent = stats.visitsFailed;
  activeMetric.textContent = stats.activeWorkers;
  timeMetric.textContent = formatTime(stats.elapsedTime);

  // Update progress
  const total = currentConfig ? currentConfig.totalVisits : 0;
  const completed = stats.visitsCompleted + stats.visitsFailed;
  const percent = total > 0 ? Math.min(Math.round((completed / total) * 100), 100) : 0;

  progressFill.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}% Completed`;
  progressFraction.textContent = `${completed} / ${total}`;

  // Update button states
  if (stats.status === 'running') {
    startBtn.setAttribute('disabled', 'true');
    pauseBtn.removeAttribute('disabled');
    stopBtn.removeAttribute('disabled');
  } else if (stats.status === 'paused') {
    startBtn.removeAttribute('disabled');
    pauseBtn.setAttribute('disabled', 'true');
    stopBtn.removeAttribute('disabled');
  } else {
    // idle / stopped
    if (currentConfig && currentConfig.targetUrl) {
      startBtn.removeAttribute('disabled');
    }
    pauseBtn.setAttribute('disabled', 'true');
    stopBtn.setAttribute('disabled', 'true');
  }
}

// Format time in seconds to HH:MM:SS
function formatTime(seconds) {
  const hrs = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

// Append log message to console
function appendLog(log) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${log.type}`;
  entry.innerHTML = `<span style="color: var(--text-secondary)">[${log.timestamp}]</span> ${escapeHTML(log.message)}`;
  
  // Since logConsole uses flex-direction: column-reverse, prepend adds to the visual bottom of the box
  logConsole.prepend(entry);
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Form Submission (Save Config)
configForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const selectedReferrers = [];
  document.querySelectorAll('input[name="referrers"]:checked').forEach(cb => {
    selectedReferrers.push(cb.value);
  });

  if (selectedReferrers.length === 0) {
    alert('Please select at least one Referrer type.');
    return;
  }

  const data = {
    targetUrl: targetUrlInput.value.trim(),
    totalVisits: parseInt(totalVisitsInput.value),
    concurrency: parseInt(concurrencyInput.value),
    minDwellTime: parseInt(minDwellTimeInput.value),
    maxDwellTime: parseInt(maxDwellTimeInput.value),
    referrers: selectedReferrers,
    headless: headlessCheckbox.checked,
    proxies: proxiesInput.value.split('\n').map(p => p.trim()).filter(Boolean)
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (res.ok) {
      const result = await res.json();
      currentConfig = result.config;
      startBtn.removeAttribute('disabled');
    } else {
      const err = await res.json();
      alert(`Error saving config: ${err.error}`);
    }
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to connect to server.');
  }
});

// Control Button Actions
startBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/start', { method: 'POST' });
  } catch (error) {
    console.error('Start error:', error);
  }
});

pauseBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/pause', { method: 'POST' });
  } catch (error) {
    console.error('Pause error:', error);
  }
});

stopBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/stop', { method: 'POST' });
  } catch (error) {
    console.error('Stop error:', error);
  }
});

// Start Stream connection on load
connectStream();
