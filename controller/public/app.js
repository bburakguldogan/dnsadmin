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
        document.getElementById('force-password-container').style.display = 'block';
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
    document.getElementById('login-container').style.display = 'block';
    document.getElementById('force-password-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'none';
  }
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('dnsadmin_token');
  document.getElementById('login-container').style.display = 'block';
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

document.getElementById('logout-btn').addEventListener('click', logout);

// ==========================================
// Dashboard Page Logic
// ==========================================

async function fetchStats() {
  try {
    const data = await apiFetch('/stats');
    document.getElementById('stat-zones').textContent = data.zones;
    document.getElementById('stat-nodes').textContent = `${data.nodes.online} / ${data.nodes.total}`;
    document.getElementById('stat-servers').textContent = data.servers;

    // Check system health indicator
    const indicatorDot = document.querySelector('.indicator-dot');
    const indicatorLabel = document.querySelector('.indicator-label');
    if (indicatorDot && indicatorLabel) {
      if (data.nodes.total > 0 && data.nodes.online === 0) {
        indicatorDot.className = 'indicator-dot error';
        indicatorLabel.textContent = 'All Nodes Offline';
        indicatorLabel.style.color = 'var(--danger-color)';
      } else if (data.nodes.total > 0 && data.nodes.online < data.nodes.total) {
        indicatorDot.className = 'indicator-dot warning';
        indicatorLabel.textContent = 'Degraded Performance';
        indicatorLabel.style.color = 'var(--warning-color)';
      } else {
        indicatorDot.className = 'indicator-dot online';
        indicatorLabel.textContent = 'All Systems Operational';
        indicatorLabel.style.color = 'var(--success-color)';
      }
    }

    renderDashboardLogs(data.recentLogs);
    drawTrafficChart();
  } catch (err) {
    console.error(err);
  }
}

function renderDashboardLogs(logs) {
  const container = document.getElementById('dashboard-log-list');
  if (logs.length === 0) {
    container.innerHTML = '<p class="text-center text-muted" style="padding: 20px;">No sync logs recorded yet</p>';
    return;
  }

  container.innerHTML = logs.map(l => {
    const time = new Date(l.created_at).toLocaleTimeString();
    const isSuccess = l.action === 'sync_success';
    return `
      <a href="#logs" class="list-group-item" style="border:none; border-bottom: 1px solid #ddd; margin-bottom:0;">
        <h4 class="list-group-item-heading" style="font-size:12px; font-weight:600; display:flex; justify-content:space-between; margin-bottom:4px;">
          <span>${l.zone}</span>
          <span class="label label-${isSuccess ? 'success' : 'danger'}">${isSuccess ? 'Success' : 'Failed'}</span>
        </h4>
        <p class="list-group-item-text" style="font-size:11px; color:#7f8c8d;">${l.message} - ${time}</p>
      </a>
    `;
  }).join('');
}

document.getElementById('dashboard-refresh-logs').addEventListener('click', fetchStats);

// Custom SVG Chart drawing logic
function drawTrafficChart() {
  const chartPathLine = document.getElementById('chart-path-line');
  const chartPathFill = document.getElementById('chart-path-fill');
  if (!chartPathLine) return;

  // Append new random traffic metric to chart data array
  state.trafficData.shift();
  state.trafficData.push(Math.floor(Math.random() * 80) + 10);

  const maxVal = 100;
  const width = 500;
  const height = 200;
  const step = width / (state.trafficData.length - 1);

  let points = state.trafficData.map((val, index) => {
    const x = index * step;
    const y = height - (val / maxVal) * (height - 20) - 10;
    return { x, y };
  });

  // Generate SVG path coordinate line (cubic curve approximation)
  let lineD = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const cpX1 = curr.x + step / 2;
    const cpY1 = curr.y;
    const cpX2 = next.x - step / 2;
    const cpY2 = next.y;
    lineD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${next.x} ${next.y}`;
  }

  const fillD = `${lineD} L ${width} ${height} L 0 ${height} Z`;

  chartPathLine.setAttribute('d', lineD);
  chartPathFill.setAttribute('d', fillD);
}

// Every 5s, redraw the dashboard graph
setInterval(() => {
  if (window.location.hash === '#dashboard' && state.token) {
    drawTrafficChart();
  }
}, 5000);

// ==========================================
// DNS Nodes Page Logic
// ==========================================

async function fetchNodes() {
  try {
    const nodes = await apiFetch('/nodes');
    const grid = document.getElementById('nodes-grid');
    
    if (nodes.length === 0) {
      grid.innerHTML = `
        <div class="col-md-12 text-center" style="padding: 40px; border: 1px dashed #ccc; background:#fff; border-radius: 4px;">
          <p style="color: #7f8c8d; margin-bottom:15px;">No authoritative nameserver nodes configured yet.</p>
          <p style="font-size:12px; color:#95a5a6">Add nodes to distribute your DNS zone files.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = nodes.map(node => {
      const isOnline = node.status === 'online';
      const statusClass = node.status;
      const lastSeen = node.last_seen ? new Date(node.last_seen).toLocaleTimeString() : 'Never';
      
      return `
        <div class="col-md-4 col-sm-6">
          <div class="box box-primary">
            <div class="box-header">
              <h3 class="box-title">${node.name}</h3>
              <span class="status-dot ${statusClass}"></span>
            </div>
            <div class="box-body">
              <p style="color: #7f8c8d; font-size:12px; margin-bottom:15px;">IP: ${node.ip || 'None'} | Port: <code style="font-family:'Source Code Pro', monospace; font-size:11px;">${node.url}</code></p>
              
              <div style="font-size:11px; margin-bottom:5px; color:#555;">CPU Usage: ${node.cpu_usage}%</div>
              <div class="progress progress-compact" style="margin-bottom:15px; height:8px;">
                <div class="progress-bar progress-bar-info" role="progressbar" style="width: ${node.cpu_usage}%"></div>
              </div>

              <div style="font-size:11px; margin-bottom:5px; color:#555;">Memory Usage: ${node.ram_usage}%</div>
              <div class="progress progress-compact" style="margin-bottom:15px; height:8px;">
                <div class="progress-bar progress-bar-info" role="progressbar" style="width: ${node.ram_usage}%"></div>
              </div>

              <div style="font-size:11px; color:#95a5a6; margin-top:10px;">Last Heartbeat: ${lastSeen}</div>
              
              <div class="masked-token-group" style="margin-top:15px; display:flex; align-items:center; gap:5px;">
                <span style="font-size:11px; color:#555;">Token:</span>
                <input type="text" class="masked-token-input" value="${node.token}" readonly style="flex:1; font-family:'Source Code Pro', monospace; font-size:11px; padding:3px 8px;">
                <button class="btn btn-default btn-xs copy-token-btn" data-token="${node.token}">Copy</button>
              </div>
            </div>
            <div class="box-footer text-right">
              <button class="btn btn-danger btn-xs delete-node-btn" data-id="${node.id}">Delete</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach copy actions
    document.querySelectorAll('.copy-token-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        navigator.clipboard.writeText(e.target.dataset.token);
        showToast('Node Token copied to clipboard!');
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

  try {
    const data = await apiFetch('/nodes', {
      method: 'POST',
      body: JSON.stringify({ name, ip, url })
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
        <div class="col-md-12 text-center" style="padding: 40px; border: 1px dashed #ccc; background:#fff; border-radius: 4px;">
          <p style="color: #7f8c8d; margin-bottom:15px;">No web servers (cPanel/Plesk agents) registered yet.</p>
          <p style="font-size:12px; color:#95a5a6">Register servers to enable automatic push integrations.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = servers.map(server => {
      const lastSync = server.last_sync ? new Date(server.last_sync).toLocaleString() : 'Never';
      const logo = server.type === 'cpanel' ? '🔴' : server.type === 'plesk' ? '🔵' : server.type === 'directadmin' ? '🟡' : '🟢';
      
      return `
        <div class="col-md-4 col-sm-6">
          <div class="box box-primary">
            <div class="box-header">
              <h3 class="box-title">${logo} ${server.name}</h3>
              <span class="label label-primary" style="text-transform:uppercase">${server.type}</span>
            </div>
            <div class="box-body">
              <p style="color: #7f8c8d; font-size:12px;">IP: ${server.ip || 'No IP'}</p>
              <p style="color: #7f8c8d; font-size:12px; margin-bottom:15px;">Last Sync: ${lastSync}</p>
              
              <div class="masked-token-group" style="display:flex; align-items:center; gap:5px;">
                <span style="font-size:11px; color:#555;">API Key:</span>
                <input type="text" class="masked-token-input" value="${server.token}" readonly style="flex:1; font-family:'Source Code Pro', monospace; font-size:11px; padding:3px 8px;">
                <button class="btn btn-default btn-xs copy-server-key-btn" data-key="${server.token}">Copy</button>
              </div>
            </div>
            <div class="box-footer text-right">
              <button class="btn btn-danger btn-xs delete-server-btn" data-id="${server.id}">Remove</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach copy actions
    document.querySelectorAll('.copy-server-key-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        navigator.clipboard.writeText(e.target.dataset.key);
        showToast('API Key copied to clipboard!');
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

  try {
    const data = await apiFetch('/servers', {
      method: 'POST',
      body: JSON.stringify({ name, ip, type })
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

async function loadZoneEditor(domain) {
  try {
    const data = await apiFetch(`/zones/${domain}`);
    state.currentZone = data.zone;
    state.currentRecords = data.records;

    document.getElementById('editor-domain-title').textContent = data.zone.domain;
    document.getElementById('editor-serial-title').textContent = data.zone.serial;
    
    renderEditorRecords();
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

// ==========================================
// Modal Window Utility Helpers
// ==========================================

function openModal(id) {
  $(`#${id}`).modal('show');
}

function closeModal(id) {
  $(`#${id}`).modal('hide');
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

// Theme Toggle Handler
function initTheme() {
  const currentTheme = localStorage.getItem('dnsadmin_theme') || 'light';
  if (currentTheme === 'dark') {
    document.body.classList.add('dark-theme');
  } else {
    document.body.classList.remove('dark-theme');
  }
}

document.getElementById('theme-toggle-btn').addEventListener('click', (e) => {
  e.preventDefault();
  document.body.classList.toggle('dark-theme');
  const theme = document.body.classList.contains('dark-theme') ? 'dark' : 'light';
  localStorage.setItem('dnsadmin_theme', theme);
  showToast(`Switched to ${theme} mode.`);
});

// Initial bootstrapper
window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  await checkAuth();
});
