build:
	@npm install
	@mkdir -p rplugin/node
	@ln -s ../.. rplugin/node/complete.nvim

.PHONY: build
