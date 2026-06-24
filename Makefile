# Makefile — build the external-chat plugin and package it into the webapp3 branding bundle.

ROOT        := $(CURDIR)
PROJECT     := $(ROOT)/external-chat
DIST        := $(PROJECT)/dist
WEBAPP3     := $(ROOT)/webapp3
PLUGIN_DIR  := $(WEBAPP3)/branding/plugins/external-chat

.PHONY: all release bump build deploy package clean

# Default: a full release (bumps the version, then packages).
all: release

# Full release: bump the minor version first, then build & package with it.
# Uses sub-makes so the bump always completes before the build starts.
release:
	$(MAKE) bump
	$(MAKE) package

# Bump the minor version in external-chat/package.json (no git commit/tag).
bump:
	cd $(PROJECT) && npm version minor --no-git-tag-version

# Build the external-chat project.
build:
	cd $(PROJECT) && npm run build

# Copy the freshly built dist into webapp3/branding/plugins/external-chat.
deploy: build
	rm -rf $(PLUGIN_DIR)
	mkdir -p $(PLUGIN_DIR)
	cp -R $(DIST)/. $(PLUGIN_DIR)/

# Zip the webapp3 bundle into external-chat-v<version>.zip using the CURRENT
# version from package.json (no bump). This is what CI calls.
package: deploy
	@VERSION=$$(node -p "require('$(PROJECT)/package.json').version"); \
	cd $(ROOT) && zip -r -q external-chat-v$$VERSION.zip webapp3 -x '*.DS_Store'; \
	echo "Created $(ROOT)/external-chat-v$$VERSION.zip"

clean:
	rm -rf $(DIST) $(PLUGIN_DIR)
