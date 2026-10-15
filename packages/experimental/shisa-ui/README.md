# Experimental Shisa account UI

English | [中文](README.zh.md)

## Usage

Mount with shisa-provider in a DSH web profile. Open Settings → Models → Shisa, then Sign in with Shisa. The real approval URL opens in a separate browser tab; the page also displays the user code. Cancel stops the Host attempt. Connected state shows organization and catalog count; Sign out revokes the device credential. This UI is independent of Jouzu.

## Model Experience

The page makes account RPC calls only. It does not submit prompts, alter default model selection or resume Sessions. Secret credentials never enter component state.

## Known Limitations and Deferred Work

While waiting, the page polls secret-free status every 1.5 seconds. Closing it stops UI polling but leaves authorization active; reopen to observe or explicitly cancel. Real account approval and inference need the user's participation.

## First-run sign-in

The plugin contributes the official `settings.models.sign-in` single slot. First-run users can sign in with Shisa, open the original DeepSeek API-key editor, or configure later. Both account surfaces share the same Host authorization Remote. Onboarding completes automatically only after authorization and a nonempty model catalog; leaving the dialog cancels an outstanding sign-in before delegating. Do not compose another contributor to this single slot simultaneously; choose the onboarding owner in deployment configuration. Uninstalling the plugin restores the Host fallback when no other contributor is present.

Onboarding now completes as soon as authorization is saved, independently of model count or catalog availability. Models shows catalog failure separately and offers Refresh models; the account remains connected. Explicit authorization links and copyable URLs are provided without preopening a blank tab.

The Models provider-card now lists the retrieved models and their declared context/output limits, plus read-only API and catalog endpoints. Refresh models performs a real catalog refresh, not just an account-state reread. The list is rendered inside the official Models extension slot, without changing the built-in DeepSeek editor. This preview does not yet implement editable model or endpoint overrides.

Catalog rows use compact two-column ID/name presentation and expandable definition lists for limits. Values are selectable text, not input controls. There is no model add/delete/edit, endpoint edit, or Cancel/Apply operation: Shisa's catalog is authoritative. Only the layout and DSH design tokens follow the built-in provider editor.
