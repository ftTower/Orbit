#!/usr/bin/env python3
"""
Web server for CyberSecurity Portfolio Search Engine
"""

from flask import Flask, render_template, jsonify, request, send_from_directory
import json
from pathlib import Path
import os

# Set template and static folders relative to this file
BASE_DIR = Path(__file__).parent
app = Flask(__name__, 
            template_folder=str(BASE_DIR / 'templates'),
            static_folder=str(BASE_DIR / 'static'))

# Load index
INDEX_FILE = Path(__file__).parent / "index.json"
index_data = {}

def load_index():
    global index_data
    if INDEX_FILE.exists():
        with open(INDEX_FILE, 'r', encoding='utf-8') as f:
            index_data = json.load(f)
    else:
        index_data = {"files": [], "tree": {}, "search_index": []}

@app.route('/')
def index():
    """Serve main dashboard"""
    return render_template('dashboard.html')

@app.route('/api/tree')
def get_tree():
    """Return file tree structure"""
    return jsonify(index_data.get("tree", {}))

@app.route('/api/search')
def search():
    """Search endpoint with priority scoring"""
    query = request.args.get('q', '').strip()
    
    if not query:
        return jsonify([])
    
    query_terms = query.lower().split()
    results = []
    
    for file_info in index_data.get("files", []):
        total_score = 0
        
        for term in query_terms:
            filename_lower = file_info['name'].lower()
            path_lower = file_info['path'].lower()
            
            # Exact match on parent folder name + readme: HIGHEST priority (300 points)
            # Example: searching "ssh" should prioritize "SSH/readme.md" over "SSH/footprinting.md"
            path_parts = path_lower.split(os.sep)
            if len(path_parts) >= 2:
                parent_folder = path_parts[-2]  # Get immediate parent folder
                if parent_folder == term and (filename_lower == 'readme.md' or filename_lower == 'readme'):
                    total_score += 300
            
            # Exact filename match (without extension): 200 points
            filename_no_ext = os.path.splitext(filename_lower)[0]
            if filename_no_ext == term:
                total_score += 200
            # Partial filename match: 100 points
            elif term in filename_lower:
                total_score += 100
            
            # Exact folder match: 150 points
            for folder in path_parts:
                if folder == term:
                    total_score += 150
                    break
            # Partial folder match: 50 points
            else:
                for folder in path_parts:
                    if term in folder:
                        total_score += 50
                        break
            
            # Content match: 5 points per occurrence (reduced from 10)
            content = file_info.get('content', '').lower()
            occurrences = content.count(term)
            total_score += occurrences * 5
            
            # Title match: 120 points
            if term in file_info.get('title', '').lower():
                total_score += 120
                
            # Headers match: 30 points
            for header in file_info.get('headers', []):
                if term in header.lower():
                    total_score += 30
            
            # Keywords match: 40 points
            for keyword in file_info.get('keywords', []):
                if term in keyword.lower():
                    total_score += 40
        
        if total_score > 0:
            results.append({
                **file_info,
                "score": total_score
            })
    
    # Sort by score
    results.sort(key=lambda x: x["score"], reverse=True)
    
    # Limit results
    return jsonify(results[:50])

@app.route('/api/file/<path:file_path>')
def get_file(file_path):
    """Get file details with full content"""
    for file_info in index_data.get("files", []):
        if file_info['path'] == file_path:
            # Read full file content
            full_path = Path(file_info['full_path'])
            if full_path.exists():
                try:
                    with open(full_path, 'r', encoding='utf-8') as f:
                        full_content = f.read()
                    # Return file info with full content
                    return jsonify({
                        **file_info,
                        'content': full_content
                    })
                except Exception as e:
                    print(f"Error reading file: {e}")
                    return jsonify(file_info)
            return jsonify(file_info)
    return jsonify({"error": "File not found"}), 404

@app.route('/api/stats')
def get_stats():
    """Get portfolio statistics"""
    files = index_data.get("files", [])
    tree = index_data.get("tree", {})
    
    # Count folders recursively
    def count_folders(node):
        count = 0
        if node.get('children'):
            for child in node['children']:
                if child.get('type') != 'file':
                    count += 1
                    count += count_folders(child)
        return count
    
    # Calculate total size (estimate based on content length)
    total_size = sum(len(file_info.get('content', '').encode('utf-8')) for file_info in files)
    
    # Count unique protocols (folders in Protocols directory)
    protocols = set()
    for file_info in files:
        path = file_info['path']
        if 'Protocols/' in path:
            # Extract protocol name (first folder after Protocols/)
            parts = path.split('Protocols/')
            if len(parts) > 1:
                protocol = parts[1].split('/')[0]
                protocols.add(protocol)
    
    stats = {
        "total_files": len(files),
        "total_folders": count_folders(tree),
        "total_size": total_size,
        "total_protocols": len(protocols)
    }
    
    return jsonify(stats)

def main():
    """Start the web server"""
    load_index()
    
    port = 5000
    print(f"\n🚀 Starting CyberSecurity Portfolio Search Engine...")
    print(f"📊 Dashboard: http://localhost:{port}")
    print(f"📁 Indexed files: {len(index_data.get('files', []))}")
    print(f"\n✓ Ready! Opening browser...")
    
    # Open browser automatically
    import webbrowser
    import threading
    
    def open_browser():
        import time
        time.sleep(1.5)  # Wait for server to start
        webbrowser.open(f'http://localhost:{port}')
    
    threading.Thread(target=open_browser).start()
    
    app.run(host='localhost', port=port, debug=False)

if __name__ == '__main__':
    main()
