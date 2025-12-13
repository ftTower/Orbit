#!/usr/bin/env python3
"""
Indexer for CyberSecurity Portfolio
Scans and indexes all markdown files with prioritization system
"""

import os
import json
import re
from pathlib import Path
from typing import Dict, List, Set

class PortfolioIndexer:
    def __init__(self, root_path: str):
        self.root_path = Path(root_path)
        self.index = {
            "files": [],
            "tree": {},
            "search_index": []
        }
        
    def calculate_priority(self, term: str, file_info: Dict) -> int:
        """
        Calculate search priority score
        - Filename match: 100 points
        - Folder name match: 50 points
        - Content match: 10 points per occurrence
        """
        score = 0
        term_lower = term.lower()
        
        # Check filename
        filename = file_info['name'].lower()
        if term_lower in filename:
            score += 100
            
        # Check folder path
        folder_path = file_info['path'].lower()
        for folder in folder_path.split(os.sep):
            if term_lower in folder:
                score += 50
                break
                
        # Check content
        content = file_info.get('content', '').lower()
        occurrences = content.count(term_lower)
        score += occurrences * 10
        
        return score
    
    def extract_metadata(self, content: str) -> Dict:
        """Extract title, headers, and keywords from markdown"""
        lines = content.split('\n')
        metadata = {
            'title': '',
            'headers': [],
            'keywords': set()
        }
        
        for line in lines:
            # Extract title (first H1)
            if line.startswith('# ') and not metadata['title']:
                metadata['title'] = line[2:].strip()
            
            # Extract headers
            if line.startswith('#'):
                header = re.sub(r'^#+\s*', '', line).strip()
                metadata['headers'].append(header)
                
            # Extract code blocks for keywords
            if '`' in line:
                keywords = re.findall(r'`([^`]+)`', line)
                metadata['keywords'].update(keywords)
        
        return metadata
    
    def should_index(self, path: Path) -> bool:
        """Check if file should be indexed"""
        # Skip hidden files and directories
        if any(part.startswith('.') for part in path.parts):
            return False
            
        # Skip node_modules, venv, etc.
        exclude_dirs = {'node_modules', 'venv', '__pycache__', '.git', '__pycache__'}
        if any(excluded in path.parts for excluded in exclude_dirs):
            return False
        
        # Skip binary and large files
        exclude_extensions = {'.pyc', '.pyo', '.so', '.dylib', '.dll', '.exe', '.bin', 
                             '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg',
                             '.mp4', '.avi', '.mov', '.mp3', '.wav', '.zip', '.tar', '.gz'}
        if path.suffix.lower() in exclude_extensions:
            return False
            
        # Accept all other files (text files, code, markdown, etc.)
        return path.is_file()
    
    def build_tree_structure(self, base_path: Path, current_path: Path) -> Dict:
        """Build hierarchical tree structure"""
        tree = {
            "name": current_path.name,
            "path": str(current_path.relative_to(base_path)),
            "type": "directory" if current_path.is_dir() else "file",
            "children": []
        }
        
        if current_path.is_dir():
            try:
                for item in sorted(current_path.iterdir()):
                    # Skip hidden and excluded items
                    if item.name.startswith('.') or item.name in {'node_modules', 'venv', '__pycache__'}:
                        continue
                    
                    if item.is_dir() or self.should_index(item):
                        tree["children"].append(self.build_tree_structure(base_path, item))
            except PermissionError:
                pass
                
        return tree
    
    def index_file(self, file_path: Path) -> Dict:
        """Index a single file"""
        try:
            # Try to read as text file
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            return None
        
        # Extract metadata only for markdown files
        if file_path.suffix.lower() == '.md':
            metadata = self.extract_metadata(content)
        else:
            metadata = {
                'title': file_path.stem,
                'headers': [],
                'keywords': set()
            }
            
        relative_path = file_path.relative_to(self.root_path)
        
        file_info = {
            "name": file_path.name,
            "path": str(relative_path),
            "full_path": str(file_path),
            "title": metadata['title'] or file_path.stem,
            "headers": metadata['headers'],
            "keywords": list(metadata['keywords']),
            "content": content[:500],  # First 500 chars for preview
            "size": file_path.stat().st_size,
            "type": file_path.suffix.lower() or 'file',
            "github_url": f"https://github.com/ftTower/CyberSecurity-Portfolio/blob/main/{relative_path}"
        }
        
        return file_info
    
    def build_index(self):
        """Build complete index of the portfolio"""
        print(f"Indexing portfolio from: {self.root_path}")
        
        # Build file index - scan all files
        for file_path in self.root_path.rglob('*'):
            if file_path.is_file() and self.should_index(file_path):
                file_info = self.index_file(file_path)
                if file_info:
                    self.index["files"].append(file_info)
        
        # Build tree structure
        self.index["tree"] = self.build_tree_structure(self.root_path, self.root_path)
        
        print(f"Indexed {len(self.index['files'])} files")
        
    def save_index(self, output_path: str = "index.json"):
        """Save index to JSON file"""
        output_file = Path(output_path)
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(self.index, f, indent=2, ensure_ascii=False)
        print(f"Index saved to: {output_file}")
        
    def search(self, query: str) -> List[Dict]:
        """Search indexed files"""
        query_terms = query.lower().split()
        results = []
        
        for file_info in self.index["files"]:
            total_score = 0
            for term in query_terms:
                total_score += self.calculate_priority(term, file_info)
            
            if total_score > 0:
                results.append({
                    **file_info,
                    "score": total_score
                })
        
        # Sort by score (highest first)
        results.sort(key=lambda x: x["score"], reverse=True)
        return results


if __name__ == "__main__":
    # Get the portfolio root directory (CyberSecurity-Portfolio folder)
    script_dir = Path(__file__).parent
    # Go up one level to Orbit, then into CyberSecurity-Portfolio
    portfolio_root = script_dir.parent / "CyberSecurity-Portfolio"
    
    print(f"Indexing portfolio from: {portfolio_root}")
    
    if not portfolio_root.exists():
        print(f"Error: Portfolio directory not found at {portfolio_root}")
        exit(1)
    
    indexer = PortfolioIndexer(str(portfolio_root))
    indexer.build_index()
    indexer.save_index(str(script_dir / "index.json"))
    
    print("\n✓ Indexing complete!")
