# Makefile — build the external-chat plugin and package it into the webapp3 branding bundle.

ROOT        := $(CURDIR)
PROJECT     := $(ROOT)/external-chat
DIST        := $(PROJECT)/dist
WEBAPP3     := $(ROOT)/webapp3
PLUGIN_DIR  := $(WEBAPP3)/branding/plugins/external-chat

.PHONY: all bump build deploy package clean

all: package

# 1. Bump the minor version in external-chat/package.json (no git commit/tag).
#    Done first so the build embeds the new version in its logs.
bump:
	cd $(PROJECT) && npm version minor --no-git-tag-version

# 2. Build the external-chat project.
build: bump
	cd $(PROJECT) && npm run build

# 3. Copy the freshly built dist into webapp3/branding/plugins/external-chat.
deploy: build
	rm -rf $(PLUGIN_DIR)
	mkdir -p $(PLUGIN_DIR)
	cp -R $(DIST)/. $(PLUGIN_DIR)/

# 4. Zip the webapp3 bundle into external-chat-v<version>.zip, named from package.json.
package: deploy
	@VERSION=$$(node -p "require('$(PROJECT)/package.json').version"); \
	cd $(ROOT) && zip -r -q external-chat-v$$VERSION.zip webapp3 -x '*.DS_Store'; \
	echo "Created $(ROOT)/external-chat-v$$VERSION.zip"

clean:
	rm -rf $(DIST) $(PLUGIN_DIR)
