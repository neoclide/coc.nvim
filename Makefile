build:
	@npm install --only=production
	@mkdir -p rplugin/node
	@ln -s ../.. rplugin/node/complete.nvim

.PHONY: build
