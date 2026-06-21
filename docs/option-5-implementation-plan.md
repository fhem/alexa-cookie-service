# Option 5 Implementation Plan

This plan implements ADR-0001 option 5 in two stages: first the reusable
Perl packages, later an optional FHEM module. This repository currently only
contains the package stage. No `FHEM/98_AlexaCookieService.pm` is created here.

## Goals

- Keep the Node.js service as the owner of Alexa login, refresh and export.
- Provide reusable Perl packages for FHEM-side integrations.
- Allow a future `AlexaCookieService` FHEM device to reuse the same packages.
- Allow a future `37_echodevice.pm` integration to use the package layer
  without copying HTTP, status or import logic or depending on a shared export
  directory.
- Avoid monkey-patching `echodevice` internals.

## Package Boundaries

### `FHEM::AlexaCookieService::Client`

Responsibilities:

- Hold service connection settings: base URL, optional `x-auth-token`, timeout.
- Build request hashes compatible with FHEM `HttpUtils_NonblockingGet`.
- Provide request builders for:
  - `GET /api/status`
  - `GET /api/cookie/login/url`
  - `POST /api/cookie/login/start`
  - `POST /api/cookie/refresh` (`save` only for legacy compatibility)
  - `GET /api/cookie` (`save` only for legacy compatibility)
  - `GET /api/cookie/text`
- Parse JSON responses with a consistent error shape.

Non-goals:

- No direct dependency on a FHEM device hash.
- No direct scheduling, readings updates or UI decisions.
- No direct shell calls to `curl`.

### `FHEM::AlexaCookieService::State`

Responsibilities:

- Normalize `/api/status` and cookie-export responses.
- Derive simple state flags such as usable cookie, refresh token and age.
- Convert status data into reading name/value pairs for callers.
- Keep secret values out of readings by default.

Non-goals:

- No REST calls.
- No FHEM command execution.

### `FHEM::AlexaCookieService::EchodeviceImport`

Responsibilities:

- Validate a target `echodevice` hash enough for import.
- Derive the dynamic export filename from the current FHEM `NR`.
- Trigger the existing `echodevice_NPMWaitForCookie($hash)` import path after
  the caller has written the export file locally.

Non-goals:

- No own cache parser.
- No monkey-patching or overriding `echodevice` functions.
- No assumptions about a fixed `NR` value across `rereadcfg`.

## Implementation Sequence

1. Add package skeletons and syntax checks.
2. Keep HTTPMOD as the only maintained user-facing example and use packages for reusable FHEM-side logic.
3. Add focused package tests for URL building, JSON parsing and export-name
   derivation.
4. Add the optional FHEM device module only after the package API is stable.
5. Evaluate whether `37_echodevice.pm` can consume the packages directly.

## Future FHEM Module Shape

The later module should be a thin UI/device layer only:

- `define <name> AlexaCookieService <baseUrl>`
- attributes for token key, timeout and target echodevice device
- `get status`
- `get loginUrl`
- `set login`
- `set refresh`
- readings derived from `State.pm`

This later module is intentionally not part of the current change.

## Current Integration Shape

The intended flow for an external refresh is:

1. Resolve the target `echodevice` hash.
2. Derive the dynamic export filename with `export_name_for_hash`.
3. Fetch the export JSON with `GET /api/cookie` through `Client.pm`.
4. Write the JSON body to the local export file named by step 2.
5. After the local write succeeds, call `trigger_import`.
6. Let the caller update readings using `State.pm`.

The package layer deliberately does not define devices, attributes, timers,
readings or commandref documentation. Those belong into a future FHEM module.
