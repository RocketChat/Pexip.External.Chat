# Makefile — build the external-chat plugin and package it into the webapp3 branding bundle.

ROOT        := $(CURDIR)
PROJECT     := $(ROOT)/external-chat
DIST        := $(PROJECT)/dist
WEBAPP3     := $(ROOT)/webapp3
PLUGIN_DIR  := $(WEBAPP3)/branding/plugins/external-chat

# Language of the plugin's UI strings (see external-chat/src/translations.ts), e.g. `make package PLUGIN_LANG=de`.
# English keeps the plain zip name; any other language is added to it (external-chat-v<version>-de.zip).
PLUGIN_LANG ?= en
ZIP_SUFFIX  := $(if $(filter en,$(PLUGIN_LANG)),,-$(PLUGIN_LANG))

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
	cd $(PROJECT) && PLUGIN_LANG=$(PLUGIN_LANG) npm run build

# Copy the freshly built dist into webapp3/branding/plugins/external-chat.
deploy: build
	rm -rf $(PLUGIN_DIR)
	mkdir -p $(PLUGIN_DIR)
	cp -R $(DIST)/. $(PLUGIN_DIR)/

# Zip the webapp3 bundle into external-chat-v<version>[-<lang>].zip using the CURRENT
# version from package.json (no bump). This is what CI calls. An existing zip is removed first: `zip` adds to an
# archive rather than replacing it, so a rebuild would otherwise keep the old build's assets next to the new ones.
package: deploy
	@VERSION=$$(node -p "require('$(PROJECT)/package.json').version"); \
	cd $(ROOT) && rm -f external-chat-v$$VERSION$(ZIP_SUFFIX).zip && \
	zip -r -q external-chat-v$$VERSION$(ZIP_SUFFIX).zip webapp3 -x '*.DS_Store'; \
	echo "Created $(ROOT)/external-chat-v$$VERSION$(ZIP_SUFFIX).zip"

clean:
	rm -rf $(DIST) $(PLUGIN_DIR)
