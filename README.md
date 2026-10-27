# FlyEnv Stripe CLI

A community FlyEnv plugin for Stripe CLI downloads, browser login, local test webhook forwarding, sample events and test-data creation. No public domain, Cloudflare zone or inbound tunnel is needed: Stripe CLI forwards test events to your running local application.

## Features

- Install an official Stripe CLI release for your platform and connect through Stripe's browser approval flow, with a visible pairing code.
- **Saved connections:** keep separate named Stripe CLI profiles and select which account configuration all plugin actions use. Requires CLI 1.55.1 or newer for separate OAuth credential profiles; the existing default connection is preserved.
- **Disconnect / log out:** clear credentials for the selected connection, revoking its OAuth session where supported. Stop listening first. Saved labels and other connections are kept; already open terminals using this connection can also be signed out. CLI warnings are shown, including failed remote revocation.
- **Sign in to another account / fresh session:** explicitly run `stripe login --new-session` for the selected profile. To use a different Stripe user, sign out of Stripe in the approval browser first. Add a new saved connection to keep the old session instead of replacing it.
- **Stripe CLI telemetry:** off by default in the plugin, with an explicit opt-in switch. Applies to new commands, listeners and terminals; existing terminals retain their launch preferences.
- Forward test webhooks to a FlyEnv site or a complete local webhook URL; inspect delivery results and copy the listener's signing secret.
- **Send test event:** choose from 15 fixtures covering successful/failed payments, refunds, Checkout, customers, invoices, subscriptions and payment-method setup. Fixtures can also create related objects/events.
- **Open Stripe CLI:** launch a terminal with the selected binary and the same account configuration as the plugin. Use any supported Stripe CLI command.
- **Test data:** create products, one-time/recurring prices, customers and subscriptions; browse the first 25 objects of each type. Prices currently support GBP, USD and EUR. Existing object IDs can also be entered directly.

The UI's listener, sample fixtures and resource operations use test mode. Subscription creation uses `default_incomplete`; Stripe may return an incomplete subscription until its first invoice is paid. The UI shows Stripe's returned status. The terminal provides the full CLI, including advanced commands the user explicitly enters.

## Install

1. Use a compatible FlyEnv host with plugin support and without the older built-in Stripe module. The module ID remains `stripe`; both integrations cannot be registered at once.
2. In **Settings → Plugin Market**, add this registry URL:

   `https://raw.githubusercontent.com/mspacemedia/flyenv-stripe-cli/main/registry.json`

3. Install **FlyEnv Stripe CLI**, then open **Stripe CLI** from the sidebar.

FlyEnv's current plugin manager requires an active FlyEnv license. It installs from the HTTPS registry and verifies the archive's SHA-256; it does not import a downloaded archive directly. Prebuilt packages are available on the [releases page](https://github.com/mspacemedia/flyenv-stripe-cli/releases). This plugin does not change FlyEnv licensing or activate the host.

## Test a webhook

1. Install/select a Stripe CLI version. Choose **Connect / update Stripe account**, compare the displayed pairing code with Stripe's browser page, and approve only if they match. Select your sandbox/test account.
2. Enter your application's complete webhook URL, for example `https://myshop.test/stripe/webhook`. Replace that path with the real route and keep its web server running.
3. Save settings and start listening. Copy the listener signing secret into your application's webhook configuration; Dashboard endpoint secrets are separate.
4. Choose a sample and press **Send test event**. Check the delivery log and your application to confirm receipt. The event filter must include the chosen event, or be empty to receive all snapshot events.
5. Use **Test data** to create a product, a recurring price and a customer, then create a subscription linking those IDs. Object creation can generate webhooks, but it does not prove the local endpoint accepted them.

A fresh account connection waits up to ten minutes and displays a pairing code. An ended attempt keeps its comparison code visible, removes its approval link and requires a fresh attempt. Do not approve an expired browser page.

If Stripe CLI already has a session, Stripe can show account permissions without a pairing code. FlyEnv ends the initial request, keeps the approval button available and asks you to finish in your browser, then choose **Check connection**. CLI 1.55.1 cannot automatically detect reapproval of unchanged accounts, so this flow does not wait for its account-list-change poll. Check connection reads the current CLI account through `stripe whoami --format json`; it reports the active account and mode, rather than claiming permissions changed. It can also be used to inspect an existing connection without starting a new login. Checking requires a CLI version supporting that command (tested with 1.55.1).

Creation requests carry idempotency keys. Retrying unchanged failed input within the current app session reuses its key; changing fields, reconnecting or restarting creates a new request. If a request times out, check Stripe before changing fields or restarting: the object may already exist. A failed list refresh cannot undo or repeat a successful creation. Resource-list errors are reported individually while successful lists remain available.

## Connections and privacy settings

Your previous CLI session remains under **Existing / default connection**. Enter a label and choose **Add connection** to create and select a separate CLI profile, then **Connect** to approve that profile in your browser. Selecting a saved connection does not automatically log in, inspect an account or start a listener. Use **Check connection** to inspect the selected CLI account. Stop the listener and finish pending account/data/terminal actions before changing the selection or telemetry.

**Disconnect / log out** uses `stripe logout` for only the selected profile, without `--all`. Stripe CLI owns credential deletion and token revocation; a CLI warning can mean local logout completed but remote revocation failed. On failure the plugin clears cached account display and reports the error rather than assuming authentication is unchanged. No automatic login or retry follows.

FlyEnv stores only labels, profile IDs, selection and the telemetry preference in its module storage. Stripe CLI handles credentials, normally through the OS credential store, with its own fallback when unavailable. The UI does not collect or store API keys. For manual key-based authentication use **Open Stripe CLI** and `stripe login --interactive`; follow the [official API-key guidance](https://docs.stripe.com/cli/api_keys). Terminal commands use the selected profile and configuration.

Telemetry defaults off, preserving the plugin's previous opt-out. The switch explicitly sets `STRIPE_CLI_TELEMETRY_OPTOUT=1` when off and `0` when on. Stripe describes usage, error, timing, OS/version and detected AI-agent collection in its [telemetry policy](https://docs.stripe.com/cli/telemetry). It says credentials, personal data, paths/code, argument values and account data are excluded. The preference affects Stripe CLI processes started by this plugin; it does not change FlyEnv's own traffic or other CLI installations. Reopen old terminals after changing the setting. Version discovery/download verification remains opted out.

## CLI commands

If listener startup reports a Stripe authentication 401/403, stop the listener, choose **Sign in to another account / fresh session**, approve the intended account or sandbox, then start listening again. The plugin never replaces a session automatically. A stored account reported by **Check connection** does not prove listener access. If fresh login still fails, check your Stripe Dashboard role and account access. A local webhook destination returning HTTP 403 is a separate delivery failure.

Choose **Open Stripe CLI**. A `stripe` function points to the selected executable and plugin configuration for that terminal session. Examples:

```sh
stripe --help
stripe trigger payment_intent.succeeded
stripe trigger invoice.payment_failed
stripe products list --limit 10
stripe customers create --name "Local test customer"
stripe subscriptions list --limit 10
```

Stripe CLI uses test mode by default; the plugin UI explicitly forces test mode for resource commands. Advanced terminal commands are user-controlled. For independent use without FlyEnv, install the [official Stripe CLI](https://docs.stripe.com/stripe-cli), run `stripe login`, then use its normal commands. The plugin archive itself is loaded by FlyEnv and is not a separate command-line executable.

## Build from source

Build against the [mspacemedia/FlyEnv source](https://github.com/mspacemedia/FlyEnv) with its dependencies installed. The tested host revision is `b32524eec377f20647a977a96b33d0d3497a866c` (FlyEnv 4.20.1 plugin API). Use Node.js 22+ and the host's Yarn dependency installation. This repository needs no separate npm dependencies.

```sh
git clone https://github.com/mspacemedia/FlyEnv.git
git -C FlyEnv checkout b32524eec377f20647a977a96b33d0d3497a866c
cd FlyEnv
yarn install
cd ..
git clone https://github.com/mspacemedia/flyenv-stripe-cli.git
cd flyenv-stripe-cli
npm test -- --flyenv-root ../FlyEnv
npm run build -- --flyenv-root ../FlyEnv
```

The scripts stage only plugin sources in a unique temporary directory under the host's `plugins/`, reuse its build tooling, then clean up that directory. They do not overwrite an existing plugin or change the host registry. Outputs: `dist/stripe-0.3.0.flyenv-plugin`, `dist/registry.json` and the unpacked `dist/stripe/`. A local rebuild changes the checksum; distribute its matching registry and archive together. Building does not upload anything.

Tests use simulated IPC/browser boundaries and local fixtures; they never approve Stripe access, create real account objects or start a listener. They cover login parsing/pairing, process cleanup, duplicate requests, idempotent retries, test-mode argv isolation, exact amount conversion, terminal quoting, localization and plugin build/import. An optional real-binary runtime test in `tests/runtime.test.ts` can be run from a FlyEnv checkout to check binary discovery and retained configuration without authenticating.

## Existing data and privacy

The plugin preserves module ID `stripe`, settings key `flyenv-stripe-settings-v1`, binaries in `<AppDir>/stripe/<version>` and configuration/PID/log paths in `<BaseDir>/stripe/`. It contains no account tokens or CLI binaries. Disable/uninstall/update retain user data and use the host's service shutdown lifecycle.

CLI commands clear inherited Stripe overrides, apply the selected telemetry preference (opted out by default), and set `STRIPE_NO_AUTO_UPDATE=1`. Login allows only HTTPS on `access.stripe.com` and `dashboard.stripe.com`; returned commands are parsed as arguments rather than executed in a shell. UI resource commands are shell-free and return selected fields rather than full resource secrets.

Plugins share FlyEnv's runtime and are not sandboxed. This plugin does not change FlyEnv's vendor/license requests. Signing secrets are redacted in the displayed log but remain in raw listener logs. Stripe CLI manages credential storage, including its plaintext fallback when an OS credential store is unavailable. CLI downloads are restricted to official Stripe GitHub releases and checked by executable version; archive-checksum verification for those CLI downloads is not yet implemented. Forwarding accepts a user-provided HTTP(S) URL; use a trusted local destination and certificate verification where possible.

BSD-3-Clause; see [LICENSE](LICENSE) and [NOTICE](NOTICE). Stripe CLI is distributed separately under its own license. This is a community plugin, not an official Stripe product.

## Shared community registry

Add `https://raw.githubusercontent.com/mspacemedia/flyenv-plugins/main/registry.json` in FlyEnv Settings → Plugin Market to browse API Client, Mocktoon and Stripe CLI together. This plugin prefers the API Tools section on updated hosts and retains its existing category on older hosts.
