# FHEM::AlexaCookieService Packages

Maintainer: sidey

More information: [fhem/alexa-cookie-service](https://github.com/fhem/alexa-cookie-service)

These Perl packages are the reusable FHEM-side integration layer for
`alexa-cookie-service`. They implement ADR-0001 option 5 up to the package
boundary only. There is intentionally no `FHEM/98_AlexaCookieService.pm` module
in this repository state.

The packages are designed so that a future FHEM device module and a possible
future `37_echodevice.pm` integration can share the same HTTP, state and import
logic. The preferred flow is to fetch the export JSON over HTTP, write it
locally in FHEM and then trigger the existing import path. `save=<filename>`
remains available only as a legacy compatibility option.

## Packages

### `FHEM::AlexaCookieService::Client`

Builds request hashes compatible with FHEM `HttpUtils_NonblockingGet` and parses
JSON responses.

Supported request builders:

- `status_request` -> `GET /api/status` (the service may auto-refresh stale state before responding)
- `login_url_request` -> `GET /api/cookie/login/url`
- `login_start_request` -> `POST /api/cookie/login/start`
- `refresh_request` -> `POST /api/cookie/refresh` (`save` only for legacy compatibility)
- `cookie_request` -> `GET /api/cookie` (`save` only for legacy compatibility)
- `cookie_text_request` -> `GET /api/cookie/text`

Constructor options:

- `base_url`: service base URL, defaults to `http://alexa-cookie-service:58080`
- `token`: optional auth token sent as `x-auth-token`
- `timeout`: request timeout in seconds, defaults to `30`

Example:

```perl
use FHEM::AlexaCookieService::Client;

my $client = FHEM::AlexaCookieService::Client->new(
  base_url => 'http://alexa-cookie-service:58080',
  token    => 'change-me',
  timeout  => 30,
);

my $request = $client->cookie_request(
  callback => sub {
    my ($param, $err, $data) = @_;
    my ($json_error, $body) = $client->decode_json_response($err, $data);
    return if $json_error;

    # Caller writes $body to the local echodevice export file and then
    # triggers the import path.
    # If you still need the legacy service-side export copy, pass save => ...
    # to the request builder.
  },
);

HttpUtils_NonblockingGet($request);
```

### `FHEM::AlexaCookieService::State`

Normalizes service responses into secret-free status structures and reading
values. It does not perform HTTP calls and does not execute FHEM commands.

Useful functions:

- `normalize_status($hashref)`
- `normalize_cookie_export($hashref)`
- `has_usable_cookie($hashref)`
- `readings_from_status($hashref)`

Example:

```perl
use FHEM::AlexaCookieService::State;

my $readings = FHEM::AlexaCookieService::State::readings_from_status($status);

for my $name (sort keys %{$readings}) {
  readingsBulkUpdate($hash, $name, $readings->{$name});
}
```

### `FHEM::AlexaCookieService::EchodeviceImport`

Contains the small amount of `echodevice`-specific glue needed for the current
import path after the caller has written the export locally.

Useful functions:

- `export_name_for_hash($echodevice_hash)`
- `validate_target($echodevice_hash)`
- `trigger_import($echodevice_hash, %args)`

The export filename is always derived from the current FHEM `NR`, for example
`696result.json`. This avoids relying on stale filenames after `rereadcfg` or
configuration changes.

`trigger_import` calls the existing `main::echodevice_NPMWaitForCookie($hash)`
entry point when it is available. It does not monkey-patch `echodevice` and does
not parse the cache file itself.

Example:

```perl
use FHEM::AlexaCookieService::EchodeviceImport;

my $error = FHEM::AlexaCookieService::EchodeviceImport::validate_target($echo_hash);
return $error if $error;

my $save_name = FHEM::AlexaCookieService::EchodeviceImport::export_name_for_hash($echo_hash);

# Fetch the export, write it locally to $save_name, then trigger echodevice import.
$error = FHEM::AlexaCookieService::EchodeviceImport::trigger_import($echo_hash);
return $error if $error;
```

## Current Integration Shape

The intended flow for an external refresh is:

1. Resolve the target `echodevice` hash.
2. Derive the dynamic export filename with `export_name_for_hash`.
3. Poll `GET /api/status` through `Client.pm` so stale service state is refreshed automatically before the response is returned.
4. Fetch the export JSON with `GET /api/cookie` through `Client.pm`.
5. Write the JSON body to the local export file named by step 2.
6. After the local write succeeds, call `trigger_import`.
7. Let the caller update readings using `State.pm`.

The package layer deliberately does not define devices, attributes, timers,
readings or commandref documentation. Those belong into a future FHEM module.

## Tests

Run the package tests with:

```bash
npm test
```

This executes:

```bash
prove -Ilib t
```

The tests cover request building, URL encoding, JSON parsing, state
normalization, reading generation, export filename derivation, target validation
and the `echodevice_NPMWaitForCookie` trigger path without requiring a running
FHEM instance.

## Non-Goals

- No `FHEM/98_AlexaCookieService.pm` module in this stage.
- No shell calls to `curl` inside the packages.
- No direct scheduling or FHEM UI logic.
- No monkey-patching or replacing `echodevice` internals.
- No storage of secret cookie values in readings.
