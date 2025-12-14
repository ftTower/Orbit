// State
let treeData = {};
let nodes = [];
let scale = 1;
let translateX = 0;
let translateY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let rootX = 15000; // Center X position of the tree
let rootY = 200;   // Top Y position of the tree
let openFolders = new Set(); // Track which folders are open (by path)
let currentLayout = null; // Store layout info for redrawing connections
let searchScores = {}; // Track cumulative search scores for files
let searchTags = []; // Array of search keywords/tags
window.currentHighlightedPath = null; // Track currently highlighted path
window.lastTopPath = null; // Track last top file to detect changes
window.manualFileSelection = false; // Track if user manually selected a file

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing...');
    loadTree();
    setupSearch();
    setupCanvas();
    setupControls();
    setupGlobalKeyboardFocus();
    setupPremiumSearchBar();
});

// Setup global keyboard focus - always capture input for search
function setupGlobalKeyboardFocus() {
    const searchInput = document.getElementById('search-input');
    
    // Focus on page load
    searchInput.focus();
    
    // Capture all keyboard input anywhere on the page (except when typing in other inputs)
    document.addEventListener('keydown', (e) => {
        const activeElement = document.activeElement;
        
        // Don't capture if we're already in search
        if (activeElement === searchInput) return;
        
        // Don't capture special keys
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (['Tab', 'Escape', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        
        // Focus the search input and let the character be typed
        searchInput.focus();
    });
    
    // Refocus on click anywhere (except on nodes or controls)
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.node') && 
            !e.target.closest('.ctrl-btn') && 
            !e.target.closest('.search-result-item')) {
            searchInput.focus();
        }
    });
}

// Add search tag
function addSearchTag(tag) {
    if (tag && !searchTags.includes(tag)) {
        searchTags.push(tag);
        renderSearchTags();
        performSearchWithTags();
    }
}

// Remove search tag
function removeSearchTag(index) {
    searchTags.splice(index, 1);
    renderSearchTags();
    performSearchWithTags();
}

// Make removeSearchTag available globally for onclick
window.removeSearchTag = removeSearchTag;

// Render search tags
function renderSearchTags() {
    const container = document.getElementById('search-tags-container');
    container.innerHTML = searchTags.map((tag, index) => `
        <div class="search-tag">
            <span>${tag}</span>
            <span class="search-tag-remove" onclick="removeSearchTag(${index})">×</span>
        </div>
    `).join('');
}

// Perform search with all tags
function performSearchWithTags() {
    if (searchTags.length === 0) {
        document.getElementById('search-results').style.display = 'none';
        document.getElementById('best-occurrence-list').innerHTML = `
            <div class="empty-state-mini">
                <p>Lancez une recherche pour voir les fichiers les plus pertinents</p>
            </div>
        `;
        // Clear scores and highlights
        searchScores = {};
        window.currentHighlightedPath = null;
        window.lastTopPath = null;
        window.manualFileSelection = false; // Reset manual selection
        document.querySelectorAll('.node.highlighted').forEach(node => {
            node.classList.remove('highlighted');
        });
        document.querySelectorAll('.connection.highlighted').forEach(conn => {
            conn.classList.remove('highlighted');
        });
        
        // Zoom out to show full map
        resetViewToOverview();
        
        // Enable ambient illumination
        setTimeout(() => illuminateAllConnections(), 100);
        return;
    }
    
    const query = searchTags.join(' ');
    performSearch(query);
}

// Load tree and create map
async function loadTree() {
    try {
        const response = await fetch('/api/tree');
        treeData = await response.json();
        
        console.log('Tree data loaded:', treeData);
        
        // Update stats
        const statsResponse = await fetch('/api/stats');
        const stats = await statsResponse.json();
        
        // Update all stats
        document.getElementById('total-files').textContent = stats.total_files || 0;
        document.getElementById('total-folders').textContent = stats.total_folders || 0;
        document.getElementById('total-size').textContent = formatSize(stats.total_size || 0);
        document.getElementById('total-protocols').textContent = stats.total_protocols || 0;
        
        // Small delay to ensure DOM is ready
        setTimeout(() => {
            createMap(treeData);
        }, 100);
    } catch (error) {
        console.error('Error loading tree:', error);
    }
}

// Format size in bytes to readable format
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Calculate comprehensive tree metrics and optimal spacing
function calculateTreeMetrics(tree) {
    let maxDepth = 0;
    let totalNodes = 0;
    let levelStats = {};
    
    function traverse(node, depth = 0, parentPath = '') {
        maxDepth = Math.max(maxDepth, depth);
        totalNodes++;
        
        if (!levelStats[depth]) {
            levelStats[depth] = {
                maxChildren: 0,
                totalNodes: 0,
                maxSiblings: 0,
                nodes: []
            };
        }
        
        levelStats[depth].totalNodes++;
        
        if (node.children && node.children.length > 0) {
            levelStats[depth].maxChildren = Math.max(levelStats[depth].maxChildren, node.children.length);
            
            // Track sibling groups
            levelStats[depth].nodes.push({
                childCount: node.children.length,
                path: parentPath + '/' + (node.name || 'root')
            });
            
            node.children.forEach(child => traverse(child, depth + 1, parentPath + '/' + (node.name || 'root')));
        }
    }
    
    traverse(tree);
    
    // Calculate max siblings at each level
    Object.keys(levelStats).forEach(level => {
        const stats = levelStats[level];
        stats.maxSiblings = stats.maxChildren;
    });
    
    return { maxDepth, totalNodes, levelStats };
}

// Calculate the width required for a subtree (bottom-up approach)
// Only considers visible children (based on openFolders state)
function calculateSubtreeWidth(node, minNodeSpacing = 300, depth = 0) {
    const nodePath = node.path || '.';
    const isRoot = depth === 0;  // Root is always at depth 0
    const isFolderOpen = isRoot || openFolders.has(nodePath);
    
    // If folder is closed or no children, just return node width
    if (!isFolderOpen || !node.children || node.children.length === 0) {
        return { width: minNodeSpacing, positions: [] };
    }
    
    // Calculate width for visible children only (recursive)
    const childrenInfo = node.children.map(child => 
        calculateSubtreeWidth(child, minNodeSpacing, depth + 1)
    );
    
    // Total width is sum of all children widths
    const totalChildrenWidth = childrenInfo.reduce((sum, info) => sum + info.width, 0);
    
    // Position children left to right
    let currentX = 0;
    const childPositions = [];
    
    childrenInfo.forEach((info, index) => {
        // Each child is centered in its allocated space
        const childCenterX = currentX + info.width / 2;
        childPositions.push({
            x: childCenterX,
            subtreeWidth: info.width,
            childPositions: info.positions
        });
        currentX += info.width;
    });
    
    // Parent is centered over its children
    const nodeWidth = Math.max(minNodeSpacing, totalChildrenWidth);
    
    return {
        width: nodeWidth,
        positions: childPositions
    };
}

// Build tree with calculated positions
function buildTreeWithPositions(tree) {
    const minNodeSpacing = 350; // Espacement minimum entre nœuds
    const levelHeight = 500; // Hauteur entre niveaux
    
    // Calculate all positions bottom-up
    const treeLayout = calculateSubtreeWidth(tree, minNodeSpacing);
    
    console.log('Tree layout calculated:', treeLayout);
    
    // Now assign absolute positions top-down
    const positioned = [];
    
    function assignPositions(node, layoutInfo, absoluteX, absoluteY, depth = 0, parentPath = '') {
        const nodeInfo = {
            node: node,
            x: absoluteX,
            y: absoluteY,
            depth: depth,
            parentPath: parentPath
        };
        positioned.push(nodeInfo);
        
        // Position children (only if folder is open)
        const currentPath = node.path || '';
        const isRoot = depth === 0;
        const isFolderOpen = isRoot || openFolders.has(currentPath);
        
        if (isFolderOpen && node.children && node.children.length > 0 && layoutInfo.positions && layoutInfo.positions.length > 0) {
            const startX = absoluteX - (layoutInfo.width / 2);
            
            // layoutInfo.positions only has visible children, so iterate over that
            layoutInfo.positions.forEach((childLayout, index) => {
                const child = node.children[index];
                const childAbsoluteX = startX + childLayout.x;
                const childAbsoluteY = absoluteY + levelHeight;
                
                assignPositions(
                    child, 
                    { width: childLayout.subtreeWidth, positions: childLayout.childPositions },
                    childAbsoluteX,
                    childAbsoluteY,
                    depth + 1,
                    currentPath
                );
            });
        }
    }
    
    // Start from center of canvas
    const canvasWidth = Math.max(60000, treeLayout.width + 10000);
    const startX = canvasWidth / 2;
    const startY = 300;
    
    assignPositions(tree, treeLayout, startX, startY);
    
    return {
        positions: positioned,
        canvasWidth: canvasWidth,
        canvasHeight: 40000,
        rootX: startX,
        rootY: startY
    };
}

// Create visual map with intelligent bottom-up layout
function createMap(tree) {
    console.log('Creating map with bottom-up layout algorithm...');
    const container = document.getElementById('map-container');
    container.innerHTML = '';
    nodes = [];
    
    // Calculate positions using bottom-up algorithm
    const layout = buildTreeWithPositions(tree);
    currentLayout = { tree, layout }; // Store for later use
    console.log('Layout calculated:', layout);
    
    // Update global root position
    rootX = layout.rootX;
    rootY = layout.rootY;
    
    // Create SVG for connections
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'connections-svg');
    svg.setAttribute('width', layout.canvasWidth.toString());
    svg.setAttribute('height', layout.canvasHeight.toString());
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.pointerEvents = 'none';
    
    // Add gradient definitions for highlighted paths
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradient.setAttribute('id', 'pathGradient');
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('y1', '0%');
    gradient.setAttribute('x2', '0%');
    gradient.setAttribute('y2', '100%');
    
    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('style', 'stop-color:rgb(99, 102, 241);stop-opacity:1');
    
    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '50%');
    stop2.setAttribute('style', 'stop-color:rgb(139, 92, 246);stop-opacity:1');
    
    const stop3 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop3.setAttribute('offset', '100%');
    stop3.setAttribute('style', 'stop-color:rgb(168, 85, 247);stop-opacity:1');
    
    gradient.appendChild(stop1);
    gradient.appendChild(stop2);
    gradient.appendChild(stop3);
    defs.appendChild(gradient);
    svg.appendChild(defs);
    
    container.appendChild(svg);
    
    // Create all visible nodes (only nodes that should be shown based on openFolders state)
    layout.positions.forEach((posInfo, index) => {
        const node = posInfo.node;
        const isRoot = posInfo.depth === 0;
        const isFile = node.type === 'file';
        
        console.log(`Creating node at depth ${posInfo.depth}:`, node.name, 'at', posInfo.x, posInfo.y);
        
        const domNode = createNode({
            name: node.name || '🏠 CyberSecurity Portfolio',
            type: isRoot ? 'root' : (isFile ? 'file' : getNodeType(node.name)),
            path: node.path || '',
            x: posInfo.x,
            y: posInfo.y,
            icon: isRoot ? '' : (isFile ? '📄' : getNodeIcon(node.name)),
            isLarge: isRoot,
            isSmall: isFile,
            children: node.children,
            parentPath: posInfo.parentPath || ''
        });
        container.appendChild(domNode);
        // All nodes created are visible (filtering done in calculateSubtreeWidth)
    });
    
    // Draw connections between parent and children (only for visible/open nodes)
    function drawConnections(node, layoutInfo, parentX, parentY, depth = 0, parentPath = '') {
        const currentPath = node.path || '';
        
        // Only draw children connections if this folder is open (or if it's root)
        const isRoot = depth === 0;
        const shouldShowChildren = isRoot || openFolders.has(currentPath);
        
        if (shouldShowChildren && node.children && node.children.length > 0 && layoutInfo.positions) {
            const startX = parentX - (layoutInfo.width / 2);
            const childY = parentY + 500; // levelHeight
            
            node.children.forEach((child, index) => {
                const childLayout = layoutInfo.positions[index];
                const childX = startX + childLayout.x;
                const childPath = child.path || '';
                
                // Draw connection line to direct child with path identification
                drawTreeConnection(svg, parentX, parentY + 60, childX, childY - 30, currentPath, childPath);
                
                // Recurse for this child
                drawConnections(
                    child,
                    { width: childLayout.subtreeWidth, positions: childLayout.childPositions },
                    childX,
                    childY,
                    depth + 1,
                    currentPath
                );
            });
        }
    }
    
    // Start drawing connections from root
    const treeLayout = calculateSubtreeWidth(tree, 350);
    drawConnections(tree, treeLayout, layout.rootX, layout.rootY, 0, '');
    
    console.log('Total nodes created:', nodes.length);
    
    // Center view on root - position root in upper portion of viewport with zoom out
    const mapCard = document.querySelector('.map-card');
    const mapHeight = mapCard ? mapCard.offsetHeight : window.innerHeight;
    
    scale = 0.5; // Zoomed out at 50% for wider overview
    translateX = window.innerWidth / 2 - layout.rootX * scale;
    translateY = mapHeight * 0.1 - layout.rootY * scale; // Position root at 20% from top
    updateTransform();
    
    // If no specific path is highlighted, illuminate all connections
    if (!window.currentHighlightedPath) {
        setTimeout(() => illuminateAllConnections(), 100);
    }
}

// Create node element
function createNode(data) {
    const node = document.createElement('div');
    node.className = `node type-${data.type}`;
    
    // Add size variants
    if (data.isLarge) node.classList.add('node-large');
    if (data.isSmall) node.classList.add('node-small');
    
    node.style.left = `${data.x}px`;
    node.style.top = `${data.y}px`;
    node.style.position = 'absolute';
    node.dataset.path = data.path || '';
    
    console.log('Creating node:', data.name, 'at', data.x, data.y);
    
    if (data.icon) {
        const icon = document.createElement('span');
        icon.className = 'node-icon';
        icon.textContent = data.icon;
        node.appendChild(icon);
    }
    
    const title = document.createElement('div');
    title.className = 'node-title';
    title.textContent = data.name;
    node.appendChild(title);
    
    if (data.children && data.children.length > 0) {
        const subtitle = document.createElement('div');
        subtitle.className = 'node-subtitle';
        const isOpen = openFolders.has(data.path);
        const indicator = isOpen ? '▼' : '▶';
        subtitle.textContent = `${indicator} ${data.children.length} items`;
        node.appendChild(subtitle);
        
        // Store reference for updating later
        node.dataset.hasChildren = 'true';
    }
    
    node.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('Node clicked:', data.name, data.path);
        
        // If it's a folder (not a file and not root), toggle open/close
        if (data.type !== 'file' && data.type !== 'root' && data.children && data.children.length > 0) {
            toggleFolder(data.path);
            
            // Update indicator
            const subtitle = node.querySelector('.node-subtitle');
            if (subtitle) {
                const isOpen = openFolders.has(data.path);
                const indicator = isOpen ? '▼' : '▶';
                subtitle.textContent = `${indicator} ${data.children.length} items`;
            }
        }
        // If it's a file, open it
        else if (data.type === 'file' && data.path) {
            openNode(data.path);
        }
        
        setActiveNode(node);
    });
    
    nodes.push({ element: node, data: data });
    
    return node;
}

// Draw tree-style connection (vertical then horizontal)
function drawTreeConnection(svg, x1, y1, x2, y2, fromPath, toPath) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    
    // Calculate control points for smooth bezier curves
    const midY = (y1 + y2) / 2;
    const offset = Math.abs(x2 - x1) * 0.15; // Dynamic curve based on distance
    
    // Elegant bezier curve
    const d = `M ${x1} ${y1} 
               C ${x1} ${y1 + offset}, ${x1} ${midY - offset}, ${x1} ${midY}
               L ${x2} ${midY}
               C ${x2} ${midY + offset}, ${x2} ${y2 - offset}, ${x2} ${y2}`;
    
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'rgba(99, 102, 241, 0.3)');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('class', 'connection');
    
    // Add data attributes to identify exact parent-child relationship
    if (fromPath !== undefined) path.setAttribute('data-from-path', fromPath);
    if (toPath !== undefined) path.setAttribute('data-to-path', toPath);
    
    svg.appendChild(path);
}

// Toggle folder open/close
function toggleFolder(folderPath) {
    console.log('Toggling folder:', folderPath);
    
    if (openFolders.has(folderPath)) {
        // Close folder
        openFolders.delete(folderPath);
        // Close all descendants too
        closeAllDescendants(folderPath);
    } else {
        // Open folder
        openFolders.add(folderPath);
    }
    
    // Recreate the entire map with new layout
    recreateMap();
}

// Close all descendants of a folder
function closeAllDescendants(folderPath) {
    nodes.forEach(({ data }) => {
        if (data.path && data.path.startsWith(folderPath + '/')) {
            openFolders.delete(data.path);
        }
    });
}

// Recreate the map with current folder states
function recreateMap() {
    if (!treeData || !treeData.name) return;
    
    // Store current viewport position
    const currentTranslateX = translateX;
    const currentTranslateY = translateY;
    const currentScale = scale;
    
    // Recreate map
    createMap(treeData);
    
    // Restore viewport position
    translateX = currentTranslateX;
    translateY = currentTranslateY;
    scale = currentScale;
    updateTransform();
}

// Get node type based on name
function getNodeType(name) {
    if (name === 'Protocols') return 'protocol';
    if (name === 'Labs') return 'lab';
    if (name === 'Utils') return 'util';
    return 'folder';
}

// Get node icon - Enhanced with better icons
function getNodeIcon(name) {
    // Main categories
    const categoryIcons = {
        'Protocols': '🌐',
        'Labs': '🧪',
        'Utils': '⚙️',
        'Courses': '📚',
        'Tools': '🔧',
    };
    
    // Protocol specific
    const protocolIcons = {
        'SSH': '🔐',
        'RDP': '🖥️',
        'SMB': '📂',
        'FTP': '📤',
        'HTTP': '🌐',
        'HTTPS': '🔒',
        'DNS': '🗂️',
        'SMTP': '📧',
        'R-Services': '⚡',
        'Rsync': '🔄',
        'WinRM': '🪟',
        'WMI': '🔮'
    };
    
    // File types
    if (name.endsWith('.md')) return '📝';
    if (name.endsWith('.sh')) return '⚡';
    if (name.endsWith('.py')) return '🐍';
    if (name.endsWith('.js')) return '💛';
    if (name.endsWith('.json')) return '📋';
    if (name.endsWith('.txt')) return '📄';
    if (name.endsWith('.pdf')) return '📕';
    
    // Check category icons first
    if (categoryIcons[name]) return categoryIcons[name];
    
    // Check protocol icons
    if (protocolIcons[name]) return protocolIcons[name];
    
    // Default folder
    return '📁';
}

// Set active node
function setActiveNode(node) {
    document.querySelectorAll('.node').forEach(n => n.classList.remove('active'));
    node.classList.add('active');
}

// Open node details
async function openNode(path) {
    try {
        const response = await fetch(`/api/file/${encodeURIComponent(path)}`);
        const fileData = await response.json();
        
        if (fileData.error) return;
        
        const panel = document.getElementById('detail-panel');
        const content = document.getElementById('panel-content');
        
        content.innerHTML = `
            <h2>${fileData.title}</h2>
            <div class="meta">📁 ${fileData.path}</div>
            <div class="content-preview">${fileData.content.substring(0, 500)}...</div>
            ${fileData.headers.length > 0 ? `
                <h3>Sections</h3>
                <ul style="margin: 0.5rem 0 1rem 1.5rem; color: var(--text-secondary);">
                    ${fileData.headers.slice(0, 5).map(h => `<li>${h}</li>`).join('')}
                </ul>
            ` : ''}
            <div class="actions">
                <button class="btn" onclick="copyPath('${fileData.full_path}')">📋 Copy</button>
                <a class="btn" href="${fileData.github_url}" target="_blank">🔗 GitHub</a>
            </div>
        `;
        
        panel.classList.remove('hidden');
    } catch (error) {
        console.error('Error loading file:', error);
    }
}

// Close panel
function closePanel() {
    document.getElementById('detail-panel').classList.add('hidden');
    document.querySelectorAll('.node').forEach(n => n.classList.remove('active'));
}

// Copy path
function copyPath(path) {
    navigator.clipboard.writeText(path);
    alert('Path copied!');
}

// Setup canvas dragging
function setupCanvas() {
    const canvas = document.getElementById('canvas');
    const container = document.getElementById('map-container');
    
    canvas.addEventListener('mousedown', (e) => {
        if (e.target === canvas || e.target === container) {
            isDragging = true;
            dragStartX = e.clientX - translateX;
            dragStartY = e.clientY - translateY;
            canvas.classList.add('grabbing');
        }
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (isDragging) {
            translateX = e.clientX - dragStartX;
            translateY = e.clientY - dragStartY;
            updateTransform();
        }
    });
    
    canvas.addEventListener('mouseup', () => {
        isDragging = false;
        canvas.classList.remove('grabbing');
    });
    
    canvas.addEventListener('mouseleave', () => {
        isDragging = false;
        canvas.classList.remove('grabbing');
    });
    
    // Wheel zoom with proper center point
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Calculate mouse position in canvas space
        const canvasX = (mouseX - translateX) / scale;
        const canvasY = (mouseY - translateY) / scale;
        
        // Apply zoom
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(0.01, Math.min(3, scale * delta));
        
        // Adjust translation to keep mouse position stable
        translateX = mouseX - canvasX * newScale;
        translateY = mouseY - canvasY * newScale;
        scale = newScale;
        
        updateTransform();
    }, { passive: false });
}

// Update transform
function updateTransform() {
    const container = document.getElementById('map-container');
    container.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
}

// Controls
function setupControls() {
    // Already defined as global functions
}
function resetView() {
    scale = 1;
    // Center on root position
    translateX = window.innerWidth / 2 - rootX;
    translateY = 100;
    updateTransform();
}

function resetViewToOverview() {
    // Zoom out to show entire map
    const mapCard = document.querySelector('.map-card');
    const mapWidth = mapCard ? mapCard.offsetWidth : window.innerWidth;
    const mapHeight = mapCard ? mapCard.offsetHeight : window.innerHeight;
    
    // Calculate zoom to fit entire tree
    const targetScale = 0.3; // Significantly zoomed out
    
    // Center on root
    const targetX = (mapWidth / 2) - (rootX * targetScale);
    const targetY = (mapHeight * 0.3) - (rootY * targetScale);
    
    // Animate to overview
    animateViewTo(targetX, targetY, targetScale, 1000);
}

function zoomIn() {
    scale = Math.min(3, scale * 1.2);
    updateTransform();
}

function zoomOut() {
    scale = Math.max(0.01, scale * 0.8);
    updateTransform();
}

// Make control functions globally accessible
window.resetView = resetView;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;

// Setup search
function setupSearch() {
    const searchInput = document.getElementById('search-input');
    const resultsContainer = document.getElementById('search-results');
    
    let searchTimeout;
    
    // Handle Enter key to add tag
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const value = searchInput.value.trim();
            if (value) {
                addSearchTag(value);
                searchInput.value = '';
            }
        } else if (e.key === 'Backspace') {
            // If input is empty and we have tags, remove the last tag
            if (searchInput.value === '' && searchTags.length > 0) {
                e.preventDefault();
                removeSearchTag(searchTags.length - 1);
            }
        }
    });
    
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        clearTimeout(searchTimeout);
        
        // Don't show results while typing, only when tags are added
        resultsContainer.style.display = 'none';
    });
    
    // Close results when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrapper')) {
            resultsContainer.style.display = 'none';
        }
    });
}

// Perform search
async function performSearch(query) {
    const resultsContainer = document.getElementById('search-results');
    const bestOccurrenceContainer = document.getElementById('best-occurrence-list');
    
    // Reset scores for new search - only keep scores for current query
    searchScores = {};
    
    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const results = await response.json();
        
        if (results.length === 0) {
            resultsContainer.innerHTML = '<div class="search-result-item" style="text-align: center; color: var(--text-muted);">Aucun résultat trouvé</div>';
            resultsContainer.style.display = 'block';
            
            // Clear best occurrence list
            bestOccurrenceContainer.innerHTML = `
                <div class="empty-state-mini">
                    <p>Aucun résultat pour cette recherche</p>
                </div>
            `;
            
            // Clear highlight
            window.currentHighlightedPath = null;
            window.lastTopPath = null;
            document.querySelectorAll('.node.highlighted').forEach(node => {
                node.classList.remove('highlighted');
            });
            document.querySelectorAll('.connection.highlighted').forEach(conn => {
                conn.classList.remove('highlighted');
            });
            
            // Zoom out to show full map
            resetViewToOverview();
            
            // Enable ambient illumination
            setTimeout(() => illuminateAllConnections(), 100);
        } else {
            // Set scores for current search results only
            results.forEach(result => {
                const path = result.path;
                if (!searchScores[path]) {
                    searchScores[path] = {
                        path: path,
                        title: result.title,
                        totalScore: result.score,
                        searchCount: 1
                    };
                } else {
                    searchScores[path].totalScore += result.score;
                    searchScores[path].searchCount += 1;
                }
            });
            
            // Update best occurrence list
            updateBestOccurrence();
            
            // Show top 5 in dropdown
            resultsContainer.innerHTML = results.slice(0, 5).map(result => `
                <div class="search-result-item" onclick="selectSearchResult('${result.path}')">
                    <div class="result-name">${result.title}</div>
                    <div class="result-path">${result.path}</div>
                </div>
            `).join('');
            resultsContainer.style.display = 'block';
        }
    } catch (error) {
        console.error('Search error:', error);
        resultsContainer.innerHTML = '<div class="search-result-item" style="color: #ff6b6b;">Erreur lors de la recherche</div>';
        resultsContainer.style.display = 'block';
    }
}

// Extract banner image URL from markdown content
function extractBannerImage(content) {
    if (!content) return null;
    
    // Look for markdown image syntax with 'banner' in the alt text or filename
    // Pattern: ![...banner...](url) or ![banner](url)
    const bannerRegex = /!\[.*banner.*\]\(([^)]+)\)/i;
    const match = content.match(bannerRegex);
    
    if (match && match[1]) {
        let imageUrl = match[1];
        
        // Convert GitHub blob URLs to raw URLs
        // From: https://github.com/user/repo/blob/main/path/image.png
        // To: https://raw.githubusercontent.com/user/repo/main/path/image.png
        imageUrl = imageUrl.replace(
            /github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\//,
            'raw.githubusercontent.com/$1/$2/$3/'
        );
        
        console.log('Banner image found:', imageUrl);
        console.log('⚠️ If image does not load, check if it\'s blocked by an ad blocker (look for ERR_BLOCKED_BY_CLIENT in console)');
        return imageUrl;
    }
    
    console.log('No banner image found in content');
    return null;
}

// Update best occurrence list
async function updateBestOccurrence() {
    const bestOccurrenceContainer = document.getElementById('best-occurrence-list');
    const currentTopFileContainer = document.getElementById('current-top-file');
    
    // Sort by total score
    const sortedFiles = Object.values(searchScores)
        .sort((a, b) => b.totalScore - a.totalScore)
        .slice(0, 5);
    
    if (sortedFiles.length === 0) {
        bestOccurrenceContainer.innerHTML = `
            <div class="empty-state-mini">
                <p>Lancez une recherche pour voir les fichiers les plus pertinents</p>
            </div>
        `;
        currentTopFileContainer.innerHTML = `
            <div class="empty-state-mini">
                <p>Aucun résultat pour le moment</p>
            </div>
        `;
        return;
    }
    
    // Display top file details in the middle card (only if not manually selected)
    if (!window.manualFileSelection) {
        const topFile = sortedFiles[0];
        
        // Fetch file content for preview
        try {
            const response = await fetch(`/api/file/${encodeURIComponent(topFile.path)}`);
            const fileData = await response.json();
            
            if (!fileData.error) {
                const contentPreview = fileData.content.substring(0, 300);
                const sections = fileData.headers.slice(0, 3);
                const bannerUrl = extractBannerImage(fileData.content);
                const backgroundStyle = bannerUrl ? `style="background-image: url('${bannerUrl}'); background-size: cover; background-position: center;"` : '';
                const bannerClass = bannerUrl ? 'has-banner' : '';
                
                currentTopFileContainer.innerHTML = `
                    <div class="top-file-details full-height ${bannerClass}" ${backgroundStyle}>
                        <div class="top-file-info">
                            <div class="top-file-title">${topFile.title}</div>
                            <div class="top-file-path">${topFile.path}</div>
                            ${sections.length > 0 ? `
                                <div class="top-file-sections">
                                    <div class="top-file-sections-title">📑 Sections</div>
                                    ${sections.map(h => `<div class="top-file-section">• ${h}</div>`).join('')}
                                </div>
                            ` : ''}
                            <div class="top-file-tags">
                                ${searchTags.map(tag => `<span class="top-file-tag">${tag}</span>`).join('')}
                            </div>
                            <div class="top-file-actions">
                                <a class="top-file-btn primary" href="${fileData.github_url}" target="_blank">
                                    🔗 Ouvrir sur GitHub
                                </a>
                            </div>
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error fetching file details:', error);
        // Fallback display without content
        currentTopFileContainer.innerHTML = `
            <div class="top-file-details">
                <div class="top-file-info">
                    <div class="top-file-title">${topFile.title}</div>
                    <div class="top-file-path">${topFile.path}</div>
                    <div class="top-file-tags">
                        ${searchTags.map(tag => `<span class="top-file-tag">${tag}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;
    }
    }
    
    // Display top files
    bestOccurrenceContainer.innerHTML = sortedFiles.map((file, index) => {
        const medals = ['🥇', '🥈', '🥉'];
        const rankDisplay = index < 3 ? medals[index] : `#${index + 1}`;
        const isActive = window.currentHighlightedPath === file.path ? 'active' : '';
        
        return `
            <div class="best-occurrence-item ${isActive}" onclick="selectTopFile('${file.path}')">
                <div class="best-occurrence-rank">${rankDisplay}</div>
                <div class="best-occurrence-info">
                    <div class="best-occurrence-name">${file.title}</div>
                    <div class="best-occurrence-score">${file.totalScore} pts</div>
                </div>
            </div>
        `;
    }).join('');
    
    // Check if top result has changed
    const currentTopPath = sortedFiles[0].path;
    if (currentTopPath !== window.lastTopPath) {
        console.log('New top file detected:', currentTopPath);
        window.lastTopPath = currentTopPath;
        
        // Only auto-display if user hasn't manually selected a file
        if (!window.manualFileSelection) {
            setTimeout(() => {
                autoDisplayTopResult(currentTopPath);
            }, 300);
        }
    } else if (sortedFiles.length > 0 && !window.currentHighlightedPath && !window.manualFileSelection) {
        // First time display
        setTimeout(() => {
            autoDisplayTopResult(currentTopPath);
        }, 300);
    }
}

// Select a file from top files list and update the display
async function selectTopFile(path) {
    console.log('Selected top file:', path);
    
    // Mark as manual selection to prevent auto-update
    window.manualFileSelection = true;
    
    // Find the file in searchScores
    const fileData = searchScores[path];
    if (!fileData) return;
    
    const currentTopFileContainer = document.getElementById('current-top-file');
    
    // Fetch file content for preview
    try {
        const response = await fetch(`/api/file/${encodeURIComponent(path)}`);
        const fullFileData = await response.json();
        
        if (!fullFileData.error) {
            const sections = fullFileData.headers.slice(0, 3);
            const bannerUrl = extractBannerImage(fullFileData.content);
            const backgroundStyle = bannerUrl ? `style="background-image: url('${bannerUrl}'); background-size: cover; background-position: center;"` : '';
            const bannerClass = bannerUrl ? 'has-banner' : '';
            
            currentTopFileContainer.innerHTML = `
                <div class="top-file-details full-height ${bannerClass}" ${backgroundStyle}>
                    <div class="top-file-info">
                        <div class="top-file-title">${fileData.title}</div>
                        <div class="top-file-path">${fileData.path}</div>
                        ${sections.length > 0 ? `
                            <div class="top-file-sections">
                                <div class="top-file-sections-title">📑 Sections</div>
                                ${sections.map(h => `<div class="top-file-section">• ${h}</div>`).join('')}
                            </div>
                        ` : ''}
                        <div class="top-file-tags">
                            ${searchTags.map(tag => `<span class="top-file-tag">${tag}</span>`).join('')}
                        </div>
                        <div class="top-file-actions">
                            <a class="top-file-btn primary" href="${fullFileData.github_url}" target="_blank">
                                🔗 Ouvrir sur GitHub
                            </a>
                        </div>
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error fetching file details:', error);
    }
    
    // Also navigate to it on the map
    selectSearchResult(path);
}

// Auto-display top result without opening panel
function autoDisplayTopResult(path) {
    console.log('Auto-displaying top result:', path);
    
    // Store current highlighted path
    window.currentHighlightedPath = path;
    
    // Open all parent folders in the path
    openPathToFile(path);
    
    // Wait for folders to open and map to recreate
    setTimeout(() => {
        // Highlight the path
        highlightPathToFile(path);
        
        // Find the node and calculate optimal zoom
        const node = document.querySelector(`[data-path="${path}"]`);
        if (node) {
            setActiveNode(node);
            
            // Calculate zoom to show entire path
            zoomToShowEntirePath(path);
        }
        
        // Update active state in best occurrence list
        updateBestOccurrence();
    }, 400);
}

// Search for specific term (used by quick links)
function searchFor(query) {
    const searchInput = document.getElementById('search-input');
    searchInput.value = query;
    searchInput.focus();
    performSearch(query);
}

// Select search result - With premium path illumination
function selectSearchResult(path) {
    console.log('Selecting search result:', path);
    const resultsContainer = document.getElementById('search-results');
    resultsContainer.style.display = 'none';
    
    // Update current highlighted path
    window.currentHighlightedPath = path;
    
    // First, open all parent folders in the path
    openPathToFile(path);
    
    // Wait for folders to open and map to recreate
    setTimeout(() => {
        console.log('Starting highlight animation for:', path);
        
        // Highlight the path with premium animation
        highlightPathToFile(path);
        
        // Find the node and calculate optimal zoom
        const node = document.querySelector(`[data-path="${path}"]`);
        console.log('Found node:', node, 'for path:', path);
        
        if (node) {
            setActiveNode(node);
            
            // Calculate zoom to show entire path
            zoomToShowEntirePath(path);
        }
        
        // Update active state in best occurrence list
        updateBestOccurrence();
    }, 400);
}

// Premium Search Bar - Custom Caret & Animated Suggestions
function setupPremiumSearchBar() {
    const searchInput = document.getElementById('search-input');
    const searchWrapper = searchInput.closest('.search-input-wrapper');
    
    // Create custom caret
    const customCaret = document.createElement('div');
    customCaret.className = 'custom-caret';
    customCaret.style.display = 'none';
    searchWrapper.appendChild(customCaret);
    
    // Position custom caret
    function updateCaretPosition() {
        const inputRect = searchInput.getBoundingClientRect();
        const wrapperRect = searchWrapper.getBoundingClientRect();
        
        // Create temporary span to measure text width
        const span = document.createElement('span');
        span.style.visibility = 'hidden';
        span.style.position = 'absolute';
        span.style.font = window.getComputedStyle(searchInput).font;
        span.style.fontSize = window.getComputedStyle(searchInput).fontSize;
        span.style.fontWeight = window.getComputedStyle(searchInput).fontWeight;
        span.textContent = searchInput.value || '';
        document.body.appendChild(span);
        
        const textWidth = span.offsetWidth;
        document.body.removeChild(span);
        
        customCaret.style.left = textWidth + 'px';
    }
    
    // Show/hide caret based on focus
    searchInput.addEventListener('focus', () => {
        customCaret.style.display = 'block';
        updateCaretPosition();
    });
    
    searchInput.addEventListener('blur', () => {
        customCaret.style.display = 'none';
    });
    
    searchInput.addEventListener('input', updateCaretPosition);
    searchInput.addEventListener('keydown', updateCaretPosition);
    searchInput.addEventListener('click', updateCaretPosition);
    
    // Animated suggestion words rotation
    const suggestionWords = document.querySelectorAll('.suggestion-word');
    let currentIndex = 0;
    
    function rotateSuggestions() {
        if (searchInput.value !== '' || searchInput === document.activeElement) {
            return; // Don't rotate while typing or focused
        }
        
        const current = suggestionWords[currentIndex];
        const nextIndex = (currentIndex + 1) % suggestionWords.length;
        const next = suggestionWords[nextIndex];
        
        // Exit current
        current.classList.remove('active');
        current.classList.add('exiting');
        
        setTimeout(() => {
            current.classList.remove('exiting');
            
            // Enter next
            next.classList.add('active');
            currentIndex = nextIndex;
        }, 400);
    }
    
    // Rotate every 3 seconds
    setInterval(rotateSuggestions, 3000);
    
    // Stop rotation on focus, restart on blur
    searchInput.addEventListener('focus', () => {
        document.getElementById('search-placeholder').style.opacity = '0';
    });
    
    searchInput.addEventListener('blur', () => {
        if (searchInput.value === '') {
            document.getElementById('search-placeholder').style.opacity = '1';
        }
    });
    
    // Initial caret position if focused
    if (document.activeElement === searchInput) {
        customCaret.style.display = 'block';
        updateCaretPosition();
    }
}

// Open all parent folders in path to make file visible
function openPathToFile(filePath) {
    const pathParts = filePath.split('/');
    let currentPath = '';
    
    // Open each parent folder
    for (let i = 0; i < pathParts.length - 1; i++) {
        currentPath += (i > 0 ? '/' : '') + pathParts[i];
        if (!openFolders.has(currentPath)) {
            openFolders.add(currentPath);
        }
    }
    
    // Recreate map with opened folders
    recreateMap();
}

// Illuminate all visible connections (ambient mode)
function illuminateAllConnections() {
    const svg = document.getElementById('connections-svg');
    if (!svg) return;
    
    const connections = svg.querySelectorAll('.connection');
    connections.forEach(conn => {
        conn.classList.add('ambient-glow');
    });
}

// Clear ambient illumination
function clearAmbientIllumination() {
    const svg = document.getElementById('connections-svg');
    if (!svg) return;
    
    const connections = svg.querySelectorAll('.connection.ambient-glow');
    connections.forEach(conn => {
        conn.classList.remove('ambient-glow');
    });
}

// Highlight path to file with premium animations
function highlightPathToFile(filePath) {
    console.log('Highlighting path to:', filePath);
    
    // Clear ambient illumination when highlighting specific path
    clearAmbientIllumination();
    
    // Clear previous highlights
    document.querySelectorAll('.node.highlighted').forEach(node => {
        node.classList.remove('highlighted');
    });
    document.querySelectorAll('.connection.highlighted').forEach(conn => {
        conn.classList.remove('highlighted');
    });
    
    // Build path array
    const pathParts = filePath.split('/');
    const pathsToHighlight = [];
    let currentPath = '';
    
    for (let i = 0; i < pathParts.length; i++) {
        currentPath += (i > 0 ? '/' : '') + pathParts[i];
        pathsToHighlight.push(currentPath);
    }
    
    console.log('Paths to highlight:', pathsToHighlight);
    
    // Highlight nodes in sequence with staggered animation
    pathsToHighlight.forEach((path, index) => {
        setTimeout(() => {
            // Try multiple selectors to find the node
            let node = document.querySelector(`[data-path="${path}"]`);
            
            // If not found, try to find by checking all nodes
            if (!node) {
                const allNodes = document.querySelectorAll('.node');
                allNodes.forEach(n => {
                    if (n.dataset.path === path) {
                        node = n;
                    }
                });
            }
            
            if (node) {
                console.log('Highlighting node:', path);
                node.classList.add('highlighted');
                
                // Add a pulse effect
                node.style.animation = 'none';
                setTimeout(() => {
                    node.style.animation = '';
                }, 10);
            } else {
                console.warn('Node not found for path:', path);
            }
            
            // Highlight connections between nodes
            if (index > 0) {
                highlightConnectionBetween(pathsToHighlight[index - 1], path);
            }
        }, index * 200); // Stagger by 200ms for better visibility
    });
}

// Highlight connection between two nodes
function highlightConnectionBetween(fromPath, toPath) {
    const svg = document.getElementById('connections-svg');
    if (!svg) {
        console.warn('SVG not found');
        return;
    }
    
    // Find the exact connection by iterating and checking data attributes
    const connections = svg.querySelectorAll('.connection');
    let found = false;
    
    connections.forEach(conn => {
        const connFrom = conn.getAttribute('data-from-path');
        const connTo = conn.getAttribute('data-to-path');
        
        if (connFrom === fromPath && connTo === toPath) {
            conn.classList.add('highlighted');
            found = true;
            console.log('✓ Connection highlighted:', fromPath, '->', toPath);
        }
    });
    
    if (!found) {
        console.warn('No connection found for:', fromPath, '->', toPath);
        console.log('Available connections:', Array.from(connections).map(c => ({
            from: c.getAttribute('data-from-path'),
            to: c.getAttribute('data-to-path')
        })));
    }
}

// Calculate zoom to show entire path
function zoomToShowEntirePath(filePath) {
    console.log('Calculating zoom for entire path:', filePath);
    
    // Get all nodes in the path
    const pathParts = filePath.split('/');
    const pathNodes = [];
    let currentPath = '';
    
    for (let i = 0; i < pathParts.length; i++) {
        currentPath += (i > 0 ? '/' : '') + pathParts[i];
        const node = document.querySelector(`[data-path="${currentPath}"]`);
        if (node) {
            pathNodes.push(node);
        }
    }
    
    if (pathNodes.length === 0) {
        console.warn('No nodes found in path');
        return;
    }
    
    // Calculate bounding box of all nodes in path
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    pathNodes.forEach(node => {
        const left = parseFloat(node.style.left) || 0;
        const top = parseFloat(node.style.top) || 0;
        minX = Math.min(minX, left);
        minY = Math.min(minY, top);
        maxX = Math.max(maxX, left);
        maxY = Math.max(maxY, top);
    });
    
    // Add padding
    const padding = 200;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;
    
    // Calculate required scale to fit entire path
    const mapCard = document.querySelector('.map-card');
    const mapWidth = mapCard ? mapCard.offsetWidth : window.innerWidth;
    const mapHeight = mapCard ? mapCard.offsetHeight : window.innerHeight;
    
    const pathWidth = maxX - minX;
    const pathHeight = maxY - minY;
    
    const scaleX = mapWidth / pathWidth;
    const scaleY = mapHeight / pathHeight;
    const optimalScale = Math.min(scaleX, scaleY, 1.0); // Cap at 1.0 for readability
    
    // Calculate center position
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    const targetX = (mapWidth / 2) - (centerX * optimalScale);
    const targetY = (mapHeight / 2) - (centerY * optimalScale);
    
    console.log('Zoom calculated:', { optimalScale, targetX, targetY, pathNodes: pathNodes.length });
    
    // Animate to show entire path
    animateViewTo(targetX, targetY, optimalScale, 1200);
}

// Animate view to target position
function animateViewTo(targetX, targetY, targetScale, duration = 800) {
    const startX = translateX;
    const startY = translateY;
    const startScale = scale;
    const startTime = performance.now();
    
    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Smooth easing function
        const eased = 1 - Math.pow(1 - progress, 3);
        
        translateX = startX + (targetX - startX) * eased;
        translateY = startY + (targetY - startY) * eased;
        scale = startScale + (targetScale - startScale) * eased;
        
        updateTransform();
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }
    
    requestAnimationFrame(animate);
}
