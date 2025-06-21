.PHONY: ul create-pool test-devnet create-static-config create-basic-pool-config dev dev-netlify build preview deploy lint test test-notify test-create-token test-confirm-token test-estimate compare-transactions

ul:
	./scripts/upsert-leaderboard.sh
create-pool:
	ts-node-esm scripts/create-pool.ts --help
test-devnet:
	ts-node-esm scripts/test-devnet.ts
create-static-config:
	ts-node-esm scripts/create-static-config.ts --help

create-basic-pool-config:
	ts-node bin/creast-basic-pool-config.ts

dev:
	yarn dev

dev-netlify:
	yarn dev:netlify

build:
	yarn build

preview:
	yarn preview

deploy:
	yarn deploy

lint:
	yarn lint

test:
	yarn test

test-notify:
	yarn test:notify

test-create-token:
	yarn test:create-token

test-confirm-token:
	yarn test:confirm-token

test-estimate:
	yarn test:estimate

compare-transactions:
	yarn compare-transactions
