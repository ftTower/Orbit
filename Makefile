.PHONY: search clean

all: search

update:
	@echo "🪢 Working on base folder..."
	@if [ -d "CyberSecurity-Portfolio" ]; then \
		cd CyberSecurity-Portfolio && git pull; \
	else \
		git clone https://github.com/ftTower/CyberSecurity-Portfolio.git; \
	fi

search:
	@make update
	@echo "🔍 Indexing portfolio..."
	@venv/bin/python search_engine/indexer.py
	@echo "🚀 Starting search engine..."
	@venv/bin/python search_engine/server.py

clean:
	@rm -rf CyberSecurity-Portfolio
	@rm -f search_engine/index.json
	@echo "✓ Cleaned index files"
