const API_BASE = '/api/v1';

// Application State
const state = {
  token: localStorage.getItem('dnsadmin_token') || null,
  user: null,
  currentZone: null,
  currentRecords: [],
  trafficData: [10, 25, 15, 30, 45, 20, 35, 60, 40, 75, 50, 90] // For mock visualization
};

// Toast notification helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
    <div>${message}</div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

// Global API Fetch helper
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  if (response.status === 401 || response.status === 403) {
    // Unauthorised/Expired
    logout();
    throw new Error('Session expired. Please login again.');
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Server error occurred');
  }

  return data;
}

// Auth Handlers
async function checkAuth() {
  if (state.token) {
    try {
      const data = await apiFetch('/auth/me');
      state.user = data.user;
      document.getElementById('user-display').textContent = state.user.username;

      if (state.user.force_password_change) {
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'none';
        document.getElementById('force-password-container').style.display = 'flex';
        return;
      }

      document.getElementById('login-container').style.display = 'none';
      document.getElementById('force-password-container').style.display = 'none';
      document.getElementById('app-container').style.display = 'block';
      
      // Default route
      if (!window.location.hash) {
        window.location.hash = '#dashboard';
      }
      navigate();
      fetchStats();
    } catch (err) {
      console.warn('Authentication token verification failed, logging out:', err.message);
      logout();
    }
  } else {
    document.getElementById('login-container').style.display = 'flex';
    document.getElementById('force-password-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'none';
  }
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('dnsadmin_token');
  document.getElementById('login-container').style.display = 'flex';
  document.getElementById('force-password-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'none';
}

// Navigation Router
function navigate() {
  const hash = window.location.hash || '#dashboard';
  const pageSections = document.querySelectorAll('.page-section');
  const menuItems = document.querySelectorAll('.sidebar-menu-item');
  
  // Hide all sections
  pageSections.forEach(sec => sec.style.display = 'none');
  menuItems.forEach(item => item.classList.remove('active'));

  let targetSectionId = 'page-dashboard';
  let targetMenuId = 'menu-dashboard';
  let title = 'Dashboard';

  if (hash === '#nodes') {
    targetSectionId = 'page-nodes';
    targetMenuId = 'menu-nodes';
    title = 'DNS Nameserver Nodes';
    fetchNodes();
  } else if (hash === '#servers') {
    targetSectionId = 'page-servers';
    targetMenuId = 'menu-servers';
    title = 'Hosting Servers (Agents)';
    fetchServers();
  } else if (hash === '#lists') {
    targetSectionId = 'page-lists';
    targetMenuId = 'menu-lists';
    title = 'RBL Blacklist Reports';
    fetchLists();
  } else if (hash === '#zones') {
    targetSectionId = 'page-zones';
    targetMenuId = 'menu-zones';
    title = 'DNS Zones';
    fetchZones();
  } else if (hash === '#logs') {
    targetSectionId = 'page-logs';
    targetMenuId = 'menu-logs';
    title = 'System & Sync Logs';
    fetchLogs();
  } else if (hash === '#users') {
    targetSectionId = 'page-users';
    targetMenuId = 'menu-users';
    title = 'Panel Administrator Accounts';
    fetchUsers();
  } else if (hash === '#profile') {
    targetSectionId = 'page-profile';
    targetMenuId = 'menu-profile';
    title = 'Edit Profile';
    fetchProfile();
  } else if (hash.startsWith('#zones/editor/')) {
    // Sub-view zone records editor
    targetSectionId = 'page-zone-editor';
    targetMenuId = 'menu-zones';
    const domain = hash.split('/').pop();
    title = `Edit DNS Zone`;
    loadZoneEditor(domain);
  }

  const targetSec = document.getElementById(targetSectionId);
  if (targetSec) targetSec.style.display = 'block';

  const targetMenu = document.getElementById(targetMenuId);
  if (targetMenu) targetMenu.classList.add('active');

  document.getElementById('page-title').textContent = title;
}

// Login Submit
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('dnsadmin_token', data.token);
    document.getElementById('user-display').textContent = data.user.username;
    
    showToast('Signed in successfully!', 'success');
    await checkAuth();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

const sidebarLogoutBtn = document.getElementById('sidebar-logout-btn');
if (sidebarLogoutBtn) {
  sidebarLogoutBtn.addEventListener('click', logout);
}

// ==========================================
// Dashboard Page Logic
// ==========================================

// ==========================================
// Dashboard Page Logic
// ==========================================

let zoneCountChart = null;
let activityChart = null;

function formatLastSeen(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  return new Date(dateStr).toLocaleDateString();
}

async function renderCharts(distribution, trend) {
  if (typeof Chart === 'undefined') {
    console.warn('[Chart] Chart.js library not loaded yet.');
    return;
  }
  const isDark = document.documentElement.classList.contains('dark');
  const textColor = isDark ? '#dae2fd' : '#64748b';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)';

  // Chart 1: Zone count per server (Bar chart)
  const ctxZone = document.getElementById('chart-zone-count');
  if (ctxZone) {
    if (zoneCountChart) zoneCountChart.destroy();
    
    const labels = distribution.map(d => d.label);
    const dataVals = distribution.map(d => d.value);
    
    zoneCountChart = new Chart(ctxZone.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels.length > 0 ? labels : ['No Servers'],
        datasets: [{
          label: 'Zones',
          data: dataVals.length > 0 ? dataVals : [0],
          backgroundColor: '#adc6ff',
          hoverBackgroundColor: '#4edea3',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { 
            beginAtZero: true, 
            grid: { color: gridColor },
            ticks: { color: textColor }
          },
          x: { 
            grid: { display: false },
            ticks: { color: textColor }
          }
        }
      }
    });
  }

  // Chart 2: Zone additions/removals (Line chart)
  const ctxActivity = document.getElementById('chart-activity');
  if (ctxActivity) {
    if (activityChart) activityChart.destroy();
    
    const labels = trend.map(t => t.month);
    const additions = trend.map(t => t.additions);
    const removals = trend.map(t => t.removals);
    
    activityChart = new Chart(ctxActivity.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels.length > 0 ? labels : ['No Data'],
        datasets: [
          {
            label: 'Additions',
            data: additions.length > 0 ? additions : [0],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true,
            tension: 0.3
          },
          {
            label: 'Removals',
            data: removals.length > 0 ? removals : [0],
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: textColor } }
        },
        scales: {
          y: { 
            beginAtZero: true, 
            grid: { color: gridColor },
            ticks: { color: textColor }
          },
          x: { 
            grid: { display: false },
            ticks: { color: textColor }
          }
        }
      }
    });
  }
}

async function fetchStats() {
  let data = { counts: { users: 0, servers: 0, zones: 0 }, distribution: [], trend: [], logs: [] };
  try {
    data = await apiFetch('/dashboard/stats');
    state.currentDistribution = data.distribution;
    state.currentTrend = data.trend;
  } catch (err) {
    console.error('Failed to load dashboard stats:', err.message);
  }

  // Stats count numbers
  const uCount = document.getElementById('dashboard-stat-users');
  const sCount = document.getElementById('dashboard-stat-servers');
  const zCount = document.getElementById('dashboard-stat-zones');
  if (uCount) uCount.textContent = data.counts.users;
  if (sCount) sCount.textContent = data.counts.servers;
  if (zCount) zCount.textContent = data.counts.zones;

  let rblListedCount = 0;
  const issueList = [];

  // Render hosting servers table
  try {
    const servers = await apiFetch('/servers');
    const serversTbody = document.getElementById('dashboard-servers-table');
    if (serversTbody) {
      if (servers.length === 0) {
        serversTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 20px;">No hosting servers registered yet.</td></tr>`;
      } else {
        serversTbody.innerHTML = servers.map(s => {
          const lastSeenStr = s.last_sync ? formatLastSeen(s.last_sync) : 'Never';
          const isOnline = s.status === 'active';
          const statusDot = isOnline ? '<span class="status-dot status-online"></span>' : '<span class="status-dot status-offline"></span>';
          if (s.rbl_status !== 'Clean') {
            rblListedCount++;
            issueList.push(`Server ${s.name} listed in RBL`);
          }
          return `
            <tr>
              <td style="font-weight: 600;">${s.name} <span class="version-badge">${s.version || 'v1.0.0'}</span></td>
              <td>${statusDot} ${lastSeenStr}</td>
              <td>${s.zone_count || 0}</td>
              <td>${s.type.toUpperCase()} | named</td>
              <td><span class="label label-${s.rbl_status === 'Clean' ? 'success' : 'danger'}">${s.rbl_status || 'Clean'}</span></td>
              <td>${s.group_name || 'Default'}</td>
            </tr>
          `;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Failed to load servers table:', err.message);
  }

  // Render DNS Nodes table
  try {
    const nodes = await apiFetch('/nodes');
    const nodesTbody = document.getElementById('dashboard-nodes-table');
    if (nodesTbody) {
      if (nodes.length === 0) {
        nodesTbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding: 20px;">No DNS nameservers registered yet.</td></tr>`;
      } else {
        nodesTbody.innerHTML = nodes.map(n => {
          const lastSeenStr = n.last_seen ? formatLastSeen(n.last_seen) : 'Never';
          const isOnline = n.status === 'online';
          const statusDot = isOnline ? '<span class="status-dot status-online"></span>' : '<span class="status-dot status-offline"></span>';
          if (!isOnline) {
            issueList.push(`Node ${n.name} is Offline`);
          }
          if (n.rbl_status !== 'Clean') {
            rblListedCount++;
            issueList.push(`Node ${n.name} listed in RBL`);
          }
          return `
            <tr>
              <td style="font-weight: 600;">${n.name} <span class="version-badge">${n.version || 'v1.0.0'}</span></td>
              <td>${statusDot} ${lastSeenStr}</td>
              <td>${data.counts.zones || 0}</td>
              <td><span class="label label-${n.rbl_status === 'Clean' ? 'success' : 'danger'}">${n.rbl_status || 'Clean'}</span></td>
              <td>${n.group_name || 'Default'}</td>
            </tr>
          `;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Failed to load nodes table:', err.message);
  }

  // RBL status card text
  const rblStatusText = document.getElementById('dashboard-rbl-status-text');
  if (rblStatusText) {
    if (rblListedCount > 0) {
      rblStatusText.textContent = `Warning: ${rblListedCount} of your server IP(s) are listed in RBL blacklists!`;
      rblStatusText.style.color = '#ef4444';
    } else {
      rblStatusText.textContent = 'Your servers are not listed in any RBL.';
      rblStatusText.style.color = 'var(--text-muted)';
    }
  }

  // Issues card text
  const issuesText = document.getElementById('dashboard-issues-text');
  const issuesCard = document.getElementById('dashboard-issues-card');
  if (issuesText && issuesCard) {
    if (issueList.length > 0) {
      issuesCard.style.borderLeft = '4px solid #ef4444';
      issuesText.innerHTML = issueList.map(i => `⚠️ ${i}`).join('<br>');
    } else {
      issuesCard.style.borderLeft = '4px solid #10b981';
      issuesText.textContent = 'No problems found';
    }
  }

  // Render latest logs table
  const logsTbody = document.getElementById('dashboard-recent-logs');
  if (logsTbody) {
    if (data.logs.length === 0) {
      logsTbody.innerHTML = `<tr><td class="text-center text-muted" style="padding: 20px;">No logs recorded yet.</td></tr>`;
    } else {
      logsTbody.innerHTML = data.logs.map(l => {
        const isSuccess = l.action.includes('success') || l.action === 'create';
        const time = new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
          <tr>
            <td>
              <span class="label label-${isSuccess ? 'success' : 'danger'}" style="font-size: 9px; text-transform: uppercase;">${l.action}</span>
            </td>
            <td style="font-weight: 600;">${l.zone}</td>
            <td class="text-muted text-right">${time}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // Render Charts
  renderCharts(data.distribution, data.trend);
}

// ==========================================
// DNS Nodes Page Logic
// ==========================================

async function fetchNodes() {
  try {
    const nodes = await apiFetch('/nodes');
    const grid = document.getElementById('nodes-grid');
    
    if (nodes.length === 0) {
      grid.innerHTML = `
        <div class="col-12 text-center py-5 border rounded bg-white shadow-sm">
          <p class="text-muted mb-2">No authoritative nameserver nodes configured yet.</p>
          <p class="small text-secondary mb-0">Add nodes to distribute your DNS zone files.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = nodes.map(node => {
      const isOnline = node.status === 'online';
      const lastSeen = node.last_seen ? new Date(node.last_seen).toLocaleTimeString() : 'Never';
      return `
        <div class="col-span-12 md:col-span-6 xl:col-span-4 bg-surface-container border border-outline-variant rounded-xl overflow-hidden shadow-lg flex flex-col h-full cyber-card">
          <div class="px-lg py-md border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
            <div class="flex flex-col gap-xs">
              <div class="flex items-center gap-sm">
                <span class="w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-secondary shadow-[0_0_8px_rgba(78,222,163,0.5)] animate-pulse' : 'bg-outline-variant'}"></span>
                <h3 class="font-headline-md text-headline-md text-on-surface font-semibold leading-tight">${node.name}</h3>
              </div>
              ${node.group_name ? `<div class="text-[11px] text-outline font-label-mono uppercase">CLUSTER: <span class="text-primary">${node.group_name}</span></div>` : ''}
            </div>
          </div>
          <div class="p-lg flex-grow space-y-md">
            <div class="text-on-surface-variant font-body-sm space-y-xs">
              <div>IP Address: <code class="text-primary font-label-mono">${node.ip || 'None'}</code></div>
              <div>Port: <code class="text-primary font-label-mono">${node.url}</code></div>
            </div>
            
            <div class="space-y-xs">
              <div class="flex justify-between items-center text-label-mono">
                <span class="text-outline">CPU Usage</span>
                <span class="text-on-surface font-semibold">${node.cpu_usage}%</span>
              </div>
              <div class="w-full h-1.5 bg-surface-container-lowest rounded-full overflow-hidden">
                <div class="h-full bg-primary animate-pulse" style="width: ${node.cpu_usage}%"></div>
              </div>
            </div>

            <div class="space-y-xs">
              <div class="flex justify-between items-center text-label-mono">
                <span class="text-outline">RAM Usage</span>
                <span class="text-on-surface font-semibold">${node.ram_usage}%</span>
              </div>
              <div class="w-full h-1.5 bg-surface-container-lowest rounded-full overflow-hidden">
                <div class="h-full bg-primary animate-pulse" style="width: ${node.ram_usage}%"></div>
              </div>
            </div>

            <div class="text-outline font-body-sm pt-xs border-t border-outline-variant/30">
              Last Heartbeat: <span class="text-on-surface-variant">${lastSeen}</span>
            </div>
            
            <div class="flex items-center bg-surface-container-lowest border border-outline-variant rounded transition-all mt-md">
              <span class="font-label-caps text-label-caps text-outline px-sm select-none">Token</span>
              <input type="text" class="w-full bg-transparent border-none focus:ring-0 text-on-surface font-label-mono text-label-mono py-sm pr-sm outline-none" value="${node.token}" readonly>
              <button class="px-sm text-outline hover:text-on-surface copy-token-btn" data-token="${node.token}">
                <span class="material-symbols-outlined text-[18px]">content_copy</span>
              </button>
            </div>
          </div>
          <div class="px-lg py-md border-t border-outline-variant/50 bg-surface-container-low flex justify-end gap-md">
            <button class="px-md py-sm bg-surface-container border border-outline-variant rounded text-on-surface hover:bg-surface-container-high transition-colors font-label-caps text-label-caps edit-node-btn" data-node='${JSON.stringify(node).replace(/'/g, "&apos;")}'>Edit</button>
            <button class="px-md py-sm bg-error-container text-on-error-container border border-error rounded hover:brightness-110 transition-all font-label-caps text-label-caps delete-node-btn" data-id="${node.id}">Delete</button>
          </div>
        </div>
      `;
    }).join('');

    // Attach copy actions
    document.querySelectorAll('.copy-token-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        navigator.clipboard.writeText(btn.getAttribute('data-token'));
        showToast('Node Token copied to clipboard!');
      });
    });

    // Attach edit actions
    document.querySelectorAll('.edit-node-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const node = JSON.parse(e.target.dataset.node);
        document.getElementById('node-id-edit').value = node.id;
        document.getElementById('node-name-edit').value = node.name;
        document.getElementById('node-ip-edit').value = node.ip || '';
        document.getElementById('node-url-edit').value = node.url;
        document.getElementById('node-group-edit').value = node.group_name || '';
        openModal('modal-edit-node');
      });
    });

    // Attach delete actions
    document.querySelectorAll('.delete-node-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        if (confirm('Are you sure you want to delete this nameserver node? It will no longer receive DNS updates.')) {
          try {
            await apiFetch(`/nodes/${e.target.dataset.id}`, { method: 'DELETE' });
            showToast('Node deleted successfully');
            fetchNodes();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      });
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Add Node Modal Triggers
document.getElementById('add-node-btn').addEventListener('click', () => {
  openModal('modal-add-node');
});

document.getElementById('add-node-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('node-name').value;
  const ip = document.getElementById('node-ip').value;
  const url = document.getElementById('node-url').value;
  const group_name = document.getElementById('node-group').value || null;

  try {
    const data = await apiFetch('/nodes', {
      method: 'POST',
      body: JSON.stringify({ name, ip, url, group_name })
    });
    
    closeModal('modal-add-node');
    document.getElementById('add-node-form').reset();
    
    // Open instructions modal with token
    document.getElementById('node-token-display').textContent = data.token;
    openModal('modal-node-token');
    
    fetchNodes();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ==========================================
// Hosting Servers Page Logic
// ==========================================

async function fetchServers() {
  try {
    const servers = await apiFetch('/servers');
    const grid = document.getElementById('servers-grid');
    
    if (servers.length === 0) {
      grid.innerHTML = `
        <div class="col-12 text-center py-5 border rounded bg-white shadow-sm">
          <p class="text-muted mb-2">No web servers (cPanel/Plesk agents) registered yet.</p>
          <p class="small text-secondary mb-0">Register servers to enable automatic push integrations.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = servers.map(server => {
      const lastSync = server.last_sync ? new Date(server.last_sync).toLocaleString() : 'Never';
      const logo = server.type === 'cpanel' ? '🔴' : server.type === 'plesk' ? '🔵' : server.type === 'directadmin' ? '🟡' : '🟢';
      return `
        <div class="col-span-12 md:col-span-6 xl:col-span-4 bg-surface-container border border-outline-variant rounded-xl overflow-hidden shadow-lg flex flex-col h-full cyber-card">
          <div class="px-lg py-md border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
            <div class="flex flex-col gap-xs">
              <div class="flex items-center gap-sm">
                <span class="text-[20px]">${logo}</span>
                <h3 class="font-headline-md text-headline-md text-on-surface font-semibold leading-tight">${server.name}</h3>
              </div>
              ${server.group_name ? `<div class="text-[11px] text-outline font-label-mono uppercase">CLUSTER: <span class="text-primary">${server.group_name}</span></div>` : ''}
            </div>
            <span class="px-sm py-0.5 rounded bg-primary-container text-on-primary-container font-label-caps text-label-caps uppercase">${server.type}</span>
          </div>
          <div class="p-lg flex-grow space-y-md">
            <div class="text-on-surface-variant font-body-sm space-y-sm">
              <div>IP Address: <code class="text-primary font-label-mono">${server.ip || 'No IP'}</code></div>
              <div>Last Synchronization: <span class="text-on-surface">${lastSync}</span></div>
            </div>
            
            <div class="flex items-center bg-surface-container-lowest border border-outline-variant rounded transition-all mt-md">
              <span class="font-label-caps text-label-caps text-outline px-sm select-none">API Key</span>
              <input type="text" class="w-full bg-transparent border-none focus:ring-0 text-on-surface font-label-mono text-label-mono py-sm pr-sm outline-none" value="${server.token}" readonly>
              <button class="px-sm text-outline hover:text-on-surface copy-server-key-btn" data-key="${server.token}">
                <span class="material-symbols-outlined text-[18px]">content_copy</span>
              </button>
            </div>
          </div>
          <div class="px-lg py-md border-t border-outline-variant/50 bg-surface-container-low flex justify-end gap-md">
            <button class="px-md py-sm bg-surface-container border border-outline-variant rounded text-on-surface hover:bg-surface-container-high transition-colors font-label-caps text-label-caps edit-server-btn" data-server='${JSON.stringify(server).replace(/'/g, "&apos;")}'>Edit</button>
            <button class="px-md py-sm bg-error-container text-on-error-container border border-error rounded hover:brightness-110 transition-all font-label-caps text-label-caps delete-server-btn" data-id="${server.id}">Remove</button>
          </div>
        </div>
      `;
    }).join('');

    // Attach copy actions
    document.querySelectorAll('.copy-server-key-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        navigator.clipboard.writeText(btn.getAttribute('data-key'));
        showToast('API Key copied to clipboard!');
      });
    });

    // Attach edit actions
    document.querySelectorAll('.edit-server-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const server = JSON.parse(e.target.dataset.server);
        document.getElementById('server-id-edit').value = server.id;
        document.getElementById('server-name-edit').value = server.name;
        document.getElementById('server-ip-edit').value = server.ip || '';
        document.getElementById('server-type-edit').value = server.type;
        document.getElementById('server-group-edit').value = server.group_name || '';
        openModal('modal-edit-server');
      });
    });

    // Attach delete actions
    document.querySelectorAll('.delete-server-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        if (confirm('Are you sure you want to remove this hosting server? Associated hooks will fail.')) {
          try {
            await apiFetch(`/servers/${e.target.dataset.id}`, { method: 'DELETE' });
            showToast('Hosting server removed successfully');
            fetchServers();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      });
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Add Server Modal triggers
document.getElementById('add-server-btn').addEventListener('click', () => {
  openModal('modal-add-server');
});

document.getElementById('add-server-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('server-name').value;
  const ip = document.getElementById('server-ip').value;
  const type = document.getElementById('server-type').value;
  const group_name = document.getElementById('server-group').value || null;

  try {
    const data = await apiFetch('/servers', {
      method: 'POST',
      body: JSON.stringify({ name, ip, type, group_name })
    });
    
    closeModal('modal-add-server');
    document.getElementById('add-server-form').reset();
    
    // Open instructions modal with token
    document.getElementById('server-token-display').textContent = data.token;
    openModal('modal-server-token');
    
    fetchServers();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Edit Node Modal submission
document.getElementById('edit-node-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('node-id-edit').value;
  const name = document.getElementById('node-name-edit').value;
  const ip = document.getElementById('node-ip-edit').value;
  const url = document.getElementById('node-url-edit').value;
  const group_name = document.getElementById('node-group-edit').value || null;

  try {
    await apiFetch(`/nodes/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, ip, url, group_name })
    });
    closeModal('modal-edit-node');
    showToast('Node details updated successfully.');
    fetchNodes();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Edit Server Modal submission
document.getElementById('edit-server-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('server-id-edit').value;
  const name = document.getElementById('server-name-edit').value;
  const ip = document.getElementById('server-ip-edit').value;
  const type = document.getElementById('server-type-edit').value;
  const group_name = document.getElementById('server-group-edit').value || null;

  try {
    await apiFetch(`/servers/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, ip, type, group_name })
    });
    closeModal('modal-edit-server');
    showToast('Hosting server details updated successfully.');
    fetchServers();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ==========================================
// RBL Lists Page Logic
// ==========================================

async function fetchLists() {
  try {
    const grid = document.getElementById('rbl-reports-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="col-md-12 text-center text-muted" style="padding:40px;">Loading blacklist report data...</div>';

    // Fetch servers and nodes
    const [servers, nodes] = await Promise.all([
      apiFetch('/servers'),
      apiFetch('/nodes')
    ]);

    const items = [
      ...servers.map(s => ({ ...s, typeLabel: 'Hosting Server' })),
      ...nodes.map(n => ({ ...n, typeLabel: 'Nameserver Node' }))
    ];

    if (items.length === 0) {
      grid.innerHTML = '<div class="col-md-12 text-center text-muted" style="padding:40px;">No registered servers or nodes found.</div>';
      return;
    }

    grid.innerHTML = items.map(item => {
      let rblData = {};
      try {
        if (item.rbl_details) {
          rblData = typeof item.rbl_details === 'string' ? JSON.parse(item.rbl_details) : item.rbl_details;
        }
      } catch (e) {
        console.error('Failed to parse RBL details:', e);
      }

      // Get all checked blacklists dynamically from the saved RBL data
      const checkedLists = Object.keys(rblData);
      if (checkedLists.length === 0) {
        // Fallback default list if no details saved yet
        checkedLists.push('zen.spamhaus.org', 'bl.spamcop.net', 'dnsbl.sorbs.net');
      }
      const rowsHtml = checkedLists.map(listHost => {
        const isListed = rblData[listHost] === 'Listed';
        const labelText = isListed ? 'Reported' : 'Clean';
        const colorClass = isListed ? 'text-red-400 font-semibold' : 'text-emerald-400';
        return `
          <tr>
            <td class="px-lg py-md">${listHost}</td>
            <td class="px-lg py-md text-right ${colorClass}">
              ${labelText}
            </td>
          </tr>
        `;
      }).join('');

      const badgeText = item.rbl_status || 'Clean';

      return `
        <div class="col-span-12 lg:col-span-6 bg-surface-container border border-outline-variant rounded-xl overflow-hidden shadow-lg flex flex-col cyber-card">
          <div class="px-lg py-md border-b border-outline-variant bg-surface-container-low flex items-center justify-between">
            <div class="flex flex-col gap-xs">
              <div class="flex items-center gap-sm">
                <span class="w-2 h-2 rounded-full ${item.rbl_status === 'Clean' ? 'bg-secondary shadow-[0_0_8px_rgba(78,222,163,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}"></span>
                <h3 class="font-headline-md text-headline-md text-on-surface font-semibold leading-tight">${item.name}</h3>
              </div>
              <div class="flex gap-sm items-center text-[11px] text-outline font-label-mono uppercase">
                <span>TYPE: <span class="text-primary">${item.typeLabel}</span></span>
                ${item.group_name ? `<span>| CLUSTER: <span class="text-secondary">${item.group_name}</span></span>` : ''}
              </div>
            </div>
            <span class="px-sm py-0.5 rounded font-label-caps text-label-caps uppercase ${item.rbl_status === 'Clean' ? 'bg-secondary-container text-on-secondary-container border border-secondary' : 'bg-error-container text-on-error-container border border-error'}">${badgeText}</span>
          </div>
          <div class="overflow-x-auto max-h-[300px] custom-scrollbar">
            <table class="w-full text-left border-collapse">
              <thead class="bg-surface-container-lowest border-b border-outline-variant">
                <tr>
                  <th class="px-lg py-md font-label-caps text-label-caps text-outline uppercase">RBL Hostname</th>
                  <th class="px-lg py-md font-label-caps text-label-caps text-outline uppercase text-right">Blacklist Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-outline-variant/30 text-on-surface font-label-mono text-label-mono">
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    showToast('Failed to load RBL reports: ' + err.message, 'error');
  }
}

// ==========================================
// DNS Zones Page Logic
// ==========================================

async function fetchZones() {
  try {
    const zones = await apiFetch('/zones');
    const tableBody = document.getElementById('zones-table-body');
    
    if (zones.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted)">
            No DNS zones created yet. Click "Create New DNS Zone" or configure cPanel/Plesk hook integration to sync automatically.
          </td>
        </tr>
      `;
      return;
    }

    renderZonesTable(zones);

    // Live search filtering
    document.getElementById('zone-search-input').oninput = (e) => {
      const search = e.target.value.toLowerCase().trim();
      const filtered = zones.filter(z => z.domain.toLowerCase().includes(search));
      renderZonesTable(filtered);
    };
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderZonesTable(zones) {
  const tableBody = document.getElementById('zones-table-body');
  tableBody.innerHTML = zones.map(zone => {
    const lastSync = zone.last_sync ? new Date(zone.last_sync).toLocaleString() : 'Never';
    return `
      <tr>
        <td class="highlight">${zone.domain}</td>
        <td><code>${zone.serial}</code></td>
        <td>${zone.ttl}s</td>
        <td>${lastSync}</td>
        <td><span class="tag online">Active</span></td>
        <td class="text-right" style="display:flex; justify-content:flex-end; gap:8px;">
          <a href="#zones/editor/${zone.domain}" class="btn btn-sm btn-outline">✏️ Records</a>
          <button class="btn btn-sm btn-danger delete-zone-btn" data-domain="${zone.domain}">🗑️ Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  // Attach delete buttons
  document.querySelectorAll('.delete-zone-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const domain = e.target.dataset.domain;
      if (confirm(`Are you sure you want to delete the zone "${domain}"? This will delete all its DNS records and remove the zone from ns1/ns2 nodes.`)) {
        try {
          await apiFetch(`/zones/${domain}`, { method: 'DELETE' });
          showToast(`Zone "${domain}" deleted successfully`);
          fetchZones();
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });
  });
}

// Add Zone triggers
document.getElementById('add-zone-btn').addEventListener('click', () => {
  openModal('modal-add-zone');
});

document.getElementById('add-zone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const domain = document.getElementById('zone-domain').value.trim();
  const ttl = parseInt(document.getElementById('zone-ttl').value, 10);

  try {
    await apiFetch('/zones', {
      method: 'POST',
      body: JSON.stringify({ domain, ttl })
    });
    
    closeModal('modal-add-zone');
    document.getElementById('add-zone-form').reset();
    showToast(`Zone "${domain}" created and syncing to nodes.`);
    fetchZones();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ==========================================
// Zone Records Editor Logic (Inline client-side arrays)
// ==========================================

async function fetchZonePropagation(domain) {
  try {
    const data = await apiFetch(`/zones/${domain}/propagation`);
    const nodesList = document.getElementById('propagation-nodes-list');
    const summaryEl = document.getElementById('propagation-summary');
    const onlineCountEl = document.getElementById('propagation-online-count');
    
    if (!data.propagation || data.propagation.length === 0) {
      nodesList.innerHTML = `<div class="text-muted small">No active DNS nodes configured to track.</div>`;
      if (onlineCountEl) onlineCountEl.textContent = '0 NODES ONLINE';
      return;
    }

    let syncedCount = 0;
    let onlineCount = 0;
    
    nodesList.innerHTML = data.propagation.map(node => {
      const isSynced = node.status === 'synced';
      const isFailed = node.status === 'failed';
      
      if (isSynced) syncedCount++;
      onlineCount++;
      
      let statusText = '100% Converged';
      let statusColorClass = 'text-emerald-400';
      let barColorClass = 'bg-emerald-500';
      let barWidth = '100%';
      
      if (isFailed) {
        statusText = 'Sync Failed';
        statusColorClass = 'text-red-400';
        barColorClass = 'bg-red-500';
        barWidth = '100%';
      } else if (node.status === 'pending') {
        statusText = 'Sync Pending...';
        statusColorClass = 'text-amber-400';
        barColorClass = 'bg-amber-500';
        barWidth = '40%';
      }
      
      return `
        <div class="space-y-xs">
          <div class="flex justify-between items-center text-label-mono text-label-mono">
            <span class="text-outline font-semibold">${node.node_name} <code class="text-[10px] text-outline">(${node.ip})</code></span>
            <span class="${statusColorClass}">${statusText}</span>
          </div>
          <div class="w-full h-1 bg-surface-container-lowest rounded-full overflow-hidden">
            <div class="h-full ${barColorClass} transition-all duration-500" style="width: ${barWidth}"></div>
          </div>
        </div>
      `;
    }).join('');
    
    const percentage = Math.round((syncedCount / data.propagation.length) * 100);
    summaryEl.innerHTML = `Your changes are propagating. Convergence: <strong class="text-primary">${percentage}%</strong> (${syncedCount}/${data.propagation.length} nodes).`;
    
    if (onlineCountEl) {
      onlineCountEl.textContent = `${onlineCount} NODES ACTIVE`;
    }
  } catch (err) {
    console.error('Failed to fetch zone propagation:', err.message);
  }
}

async function loadZoneEditor(domain) {
  try {
    const data = await apiFetch(`/zones/${domain}`);
    state.currentZone = data.zone;
    state.currentRecords = data.records;

    document.getElementById('editor-domain-title').textContent = data.zone.domain;
    document.getElementById('editor-serial-title').textContent = data.zone.serial;
    
    renderEditorRecords();

    // Fetch propagation immediately
    await fetchZonePropagation(domain);

    // Setup active poller
    if (state.propagationInterval) clearInterval(state.propagationInterval);
    state.propagationInterval = setInterval(async () => {
      if (window.location.hash.startsWith('#zones/editor/')) {
        await fetchZonePropagation(domain);
      } else {
        clearInterval(state.propagationInterval);
      }
    }, 4000);
  } catch (err) {
    showToast(err.message, 'error');
    window.location.hash = '#zones';
  }
}

function renderEditorRecords() {
  const tableBody = document.getElementById('records-table-body');
  if (state.currentRecords.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted)">No records defined</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = state.currentRecords.map((rec, index) => {
    // Hide delete buttons for SOA record to prevent critical misconfigurations
    const isSOA = rec.type === 'SOA';
    return `
      <tr>
        <td><code>${rec.name}</code></td>
        <td><span class="tag online" style="background-color:rgba(255,255,255,0.05); color:#fff; border:none">${rec.type}</span></td>
        <td style="max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${rec.content}</td>
        <td>${rec.priority || 0}</td>
        <td>${rec.ttl}s</td>
        <td class="text-right">
          ${isSOA ? '<span style="font-size:0.75rem; color:var(--text-dim)">Immutable</span>' : `<button class="btn btn-sm btn-danger remove-record-btn" data-index="${index}">Remove</button>`}
        </td>
      </tr>
    `;
  }).join('');

  // Attach record removal listeners
  document.querySelectorAll('.remove-record-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index, 10);
      state.currentRecords.splice(index, 1);
      renderEditorRecords();
    });
  });
}

// Listen to Record Type Selector to hide/show priority input
document.getElementById('rec-type').addEventListener('change', (e) => {
  const type = e.target.value;
  const pGroup = document.getElementById('rec-priority-group');
  if (type === 'MX' || type === 'SRV') {
    pGroup.style.display = 'block';
  } else {
    pGroup.style.display = 'none';
  }
});

// Add record to client memory list
document.getElementById('add-record-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('rec-name').value.trim();
  const type = document.getElementById('rec-type').value;
  const priority = parseInt(document.getElementById('rec-priority').value, 10) || 0;
  const content = document.getElementById('rec-content').value.trim();
  const ttl = parseInt(document.getElementById('rec-ttl').value, 10) || 3600;

  // Basic validation
  if (!name || !content) return;

  // Format owner name
  let formattedName = name;
  const domain = state.currentZone.domain;
  if (formattedName !== '@' && !formattedName.endsWith(domain)) {
    formattedName = formattedName === '' ? domain : `${formattedName}.${domain}`;
  } else if (formattedName === '@') {
    formattedName = domain;
  }

  state.currentRecords.push({
    name: formattedName,
    type,
    content,
    priority,
    ttl
  });

  renderEditorRecords();
  document.getElementById('add-record-form').reset();
  document.getElementById('rec-priority-group').style.display = 'none';
  showToast('Record added to staging list.');
});

// Save all staging records back to SQL database and push to ns1/ns2 nodes
document.getElementById('save-records-btn').addEventListener('click', async () => {
  const domain = state.currentZone.domain;
  try {
    const data = await apiFetch(`/zones/${domain}`, {
      method: 'PUT',
      body: JSON.stringify({ records: state.currentRecords })
    });
    
    document.getElementById('editor-serial-title').textContent = data.serial;
    showToast(`Zone records successfully saved! Pushing updates to active DNS nodes.`);
    
    // Refresh propagation immediately
    await fetchZonePropagation(domain);
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('editor-back-btn').addEventListener('click', () => {
  window.location.hash = '#zones';
});

// ==========================================
// Sync Logs Page Logic
// ==========================================

async function fetchLogs() {
  try {
    const logs = await apiFetch('/logs');
    const tableBody = document.getElementById('logs-table-body');
    
    if (logs.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-muted)">
            No synchronization activity logged yet.
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = logs.map(l => {
      const time = new Date(l.created_at).toLocaleString();
      const isSuccess = l.action === 'sync_success';
      return `
        <tr>
          <td>${time}</td>
          <td><span style="font-weight:600">${l.node_name || 'Global'}</span></td>
          <td class="highlight">${l.zone}</td>
          <td><span class="tag ${isSuccess ? 'online' : 'error'}">${l.action}</span></td>
          <td style="font-family: var(--font-mono); font-size:0.8rem; color:var(--text-muted)">${l.message}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

document.getElementById('logs-refresh-btn').addEventListener('click', fetchLogs);
document.getElementById('clear-logs-btn').addEventListener('click', async () => {
  if (confirm('Are you sure you want to clear all synchronization logs?')) {
    try {
      await apiFetch('/logs', { method: 'DELETE' });
      showToast('Logs cleared successfully.');
      fetchLogs();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
});

// ==========================================
// Modal Window Utility Helpers
// ==========================================

function openModal(id) {
  const modalEl = document.getElementById(id);
  if (modalEl) {
    modalEl.classList.remove('hidden');
  }
}

function closeModal(id) {
  const modalEl = document.getElementById(id);
  if (modalEl) {
    modalEl.classList.add('hidden');
  }
}

// Copy triggers for tokens
document.getElementById('copy-node-token').addEventListener('click', () => {
  const token = document.getElementById('node-token-display').textContent;
  navigator.clipboard.writeText(token);
  showToast('Node token copied!');
});

document.getElementById('copy-server-token').addEventListener('click', () => {
  const token = document.getElementById('server-token-display').textContent;
  navigator.clipboard.writeText(token);
  showToast('Agent API key copied!');
});

// ==========================================
// User Administration Page Logic
// ==========================================
async function fetchUsers() {
  try {
    const users = await apiFetch('/users');
    const tableBody = document.getElementById('users-table-body');
    if (users.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No panel users created yet.</td></tr>';
      return;
    }

    tableBody.innerHTML = users.map(u => {
      const createdAt = new Date(u.created_at).toLocaleString();
      return `
        <tr>
          <td><strong>${u.username}</strong></td>
          <td>${u.email || '<span class="text-muted">Not Set</span>'}</td>
          <td><span class="label label-info">${u.role}</span></td>
          <td>${createdAt}</td>
          <td class="text-right">
            <button class="btn btn-xs btn-danger delete-user-btn" data-id="${u.id}" data-name="${u.username}">Remove</button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach delete action listeners
    document.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const userId = e.target.dataset.id;
        const userName = e.target.dataset.name;
        if (confirm(`Are you sure you want to remove user "${userName}"?`)) {
          try {
            await apiFetch(`/users/${userId}`, { method: 'DELETE' });
            showToast('User account deleted successfully.');
            fetchUsers();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      });
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Bind modal toggle
document.getElementById('add-user-btn').addEventListener('click', () => {
  openModal('modal-add-user');
});

// Bind creation form submit
document.getElementById('add-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('new-user-username').value.trim();
  const email = document.getElementById('new-user-email').value.trim();
  const password = document.getElementById('new-user-password').value;

  try {
    await apiFetch('/users', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, role: 'admin' })
    });
    closeModal('modal-add-user');
    document.getElementById('add-user-form').reset();
    showToast('Panel administrator created successfully.');
    fetchUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ==========================================
// Profile Management Page Logic
// ==========================================
async function fetchProfile() {
  try {
    const user = await apiFetch('/profile');
    document.getElementById('profile-username').value = user.username;
    document.getElementById('profile-email').value = user.email || '';
    document.getElementById('profile-password').value = '';
    document.getElementById('profile-confirm-password').value = '';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('profile-email').value.trim();
  const password = document.getElementById('profile-password').value;
  const confirmPassword = document.getElementById('profile-confirm-password').value;

  if (password && password !== confirmPassword) {
    showToast('Passwords do not match.', 'error');
    return;
  }

  try {
    await apiFetch('/profile', {
      method: 'PUT',
      body: JSON.stringify({ email, password: password || null })
    });
    showToast('Profile details updated successfully.');
    fetchProfile();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Force Password Change Form Submit Handler
document.getElementById('force-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('force-email').value.trim();
  const password = document.getElementById('force-new-password').value;
  const confirmPassword = document.getElementById('force-confirm-password').value;

  if (password !== confirmPassword) {
    showToast('Passwords do not match.', 'error');
    return;
  }

  try {
    await apiFetch('/profile', {
      method: 'PUT',
      body: JSON.stringify({ email, password })
    });
    
    showToast('Password updated successfully. Please log in with your new password.', 'success');
    logout();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function initTheme() {
  const currentTheme = localStorage.getItem('dnsadmin_theme') || 'dark';
  if (currentTheme === 'dark') {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark-theme');
  } else {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark-theme');
  }
}

function toggleTheme(e) {
  if (e) e.preventDefault();
  const isDark = document.documentElement.classList.contains('dark');
  if (isDark) {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark-theme');
    localStorage.setItem('dnsadmin_theme', 'light');
    showToast('Switched to light mode.');
  } else {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark-theme');
    localStorage.setItem('dnsadmin_theme', 'dark');
    showToast('Switched to dark mode.');
  }
  if (state.currentDistribution && state.currentTrend) {
    renderCharts(state.currentDistribution, state.currentTrend);
  }
}

const toggleBtnTop = document.getElementById('theme-toggle-btn');
if (toggleBtnTop) {
  toggleBtnTop.addEventListener('click', toggleTheme);
}
const toggleBtnSidebar = document.getElementById('theme-toggle-btn-sidebar');
if (toggleBtnSidebar) {
  toggleBtnSidebar.addEventListener('click', toggleTheme);
}

// Initial bootstrapper
window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  // Mobile Sidebar Toggle event handler
  const toggleBtn = document.getElementById('mobile-sidebar-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sidebar = document.querySelector('.sidebar-wrapper');
      if (sidebar) sidebar.classList.toggle('show-mobile-sidebar');
    });
  }

  // Password visibility toggle on login view
  const togglePassBtn = document.getElementById('toggle-login-password');
  if (togglePassBtn) {
    togglePassBtn.addEventListener('click', () => {
      const passInput = document.getElementById('password');
      const icon = togglePassBtn.querySelector('.material-symbols-outlined');
      if (passInput && icon) {
        if (passInput.type === 'password') {
          passInput.type = 'text';
          icon.textContent = 'visibility_off';
        } else {
          passInput.type = 'password';
          icon.textContent = 'visibility';
        }
      }
    });
  }

  // Close sidebar on click outside or navigation
  document.addEventListener('click', (e) => {
    if (window.innerWidth < 768) {
      const sidebar = document.querySelector('.sidebar-wrapper');
      if (sidebar && sidebar.classList.contains('show-mobile-sidebar') && !sidebar.contains(e.target)) {
        sidebar.classList.remove('show-mobile-sidebar');
      }
    }
  });

  window.addEventListener('hashchange', () => {
    if (window.innerWidth < 768) {
      const sidebar = document.querySelector('.sidebar-wrapper');
      if (sidebar) sidebar.classList.remove('show-mobile-sidebar');
    }
  });

  await checkAuth();
});
