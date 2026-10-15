# Experimental Shisa provider

English | [中文](README.zh.md)

## Usage

Mount this plugin with DSH authorization, credentials, LLM and Typert services; mount shisa-ui for browser sign-in under Settings → Models → Shisa. Neither package requires Jouzu. The real device flow uses client_id jouzu, displays the approval URL and user code, and stores the grant before acknowledging receipt. An unconfirmed acknowledgement remains an error; restart attempts to confirm the stored grant before loading models. Cancellation stops polling. Secrets remain on the Host.

## Models and credentials

After authorization the plugin fetches the granted model_catalog_url and registers its model offerings under the shisa route using PiAiAdapter and the granted openai_base_url. Requests resolve the saved grant rather than ambient credentials. Catalog and request failures are surfaced; no model is synthesized when the catalog is unavailable. Initial integration uses text input and OpenAI Chat Completions; provider-specific capability metadata requires further qualification.

The plugin publishes the API key through the SHISA_API_KEY credential reference for explicitly configured external consumers. Jouzu can resolve that reference for its own subprocess; provider authentication does not select an Agent preset. Automatic consumption of DSH-owned provider credentials by Jouzu still needs a provider-neutral integration. Credential reference changes terminate processes that pinned that credential. They are never silently restarted or resumed. Sign-out requests server revocation and only clears local credentials after confirmation; failed revocation retains the credential for retry.

## Configuration

The gateway defaults to https://gateway.shisa.ai, requestTimeoutMs to 30000 and maxResponseBytes to 1048576. clientVersion identifies the DSH integration while client_id remains jouzu. Gateway URLs must use HTTPS without credentials, query or fragment. The installation identity is stored once in a separate DSH credential record. Jouzu installation files and auth.json are never modified.

## Model Experience

Authorization and catalog discovery add no prompt content. Model requests use the existing pi-ai adapter's stream, tool and usage conversion. API keys and link tokens are never Session events or tool output.

## Known Limitations and Deferred Work

Real browser device-code issuance and cancellation were exercised without approving an account. User approval, authenticated catalog compatibility and real model inference remain account-dependent acceptance steps. Returned HTTPS service endpoints are trusted as delegated by the configured Shisa gateway. Persisted grants and the exported credential reference are separate storage operations; a failed reference publication is reported rather than treating Jouzu as ready. Existing running Jouzu sessions do not acquire newly authorized credentials automatically. Custom deployment gateways need a matching Jouzu catalog configuration. Cross-tab authorization is shared at the Host; closing the account view does not cancel an attempt, and the explicit Cancel action does.

## Official-package preview

The provider composes the published pi-ai plugin in an isolated LLM/authorization scope and registers its adapter through the public LLM service. It does not import pi-ai implementation helpers or require Host exports. The Models directory and device flow remain Shisa-owned. Sign out before replacing an account. The current preview is qualified against official DSH 0.2.1-alpha.2, not the latest release tag.

## Independent authorization and model discovery

Authorization commits the received credential and reports signed-in immediately. Organization metadata, voice endpoints and model endpoints are not login prerequisites. Model discovery runs separately with `catalogPhase`/`catalogError`; endpoint security checks occur before model access. `refreshModels` retries a failed catalog without authorizing again. Stored login is restored without waiting for a catalog request. A failed receipt acknowledgement is logged separately from the saved login.

The account Remote exposes a secret-free catalog snapshot (model IDs/names, declared limits, delegated endpoint URLs and refresh timestamp). Refresh always fetches the live catalog, including when a generation already exists. Candidate adapters are constructed before swapping registration; failed construction retains the serving adapter. Previous generation scopes stay owned until sign-out/unload so prepared calls retain their original adapter. Endpoint and model overrides are not editable in this preview; the gateway remains authoritative.
