use strict;
use warnings;

use Test::More;

use FHEM::AlexaCookieService::State;

my $status = FHEM::AlexaCookieService::State::normalize_status({
  ok              => 1,
  updatedAt       => '2026-06-13T10:00:00.000Z',
  ageHours        => 2.25,
  hasCookie       => 1,
  hasCsrf         => 0,
  hasRefreshToken => 1,
  amazonPage      => 'amazon.de',
  state           => { localCookie => '<redacted>' },
});

is_deeply $status, {
  ok              => 1,
  updatedAt       => '2026-06-13T10:00:00.000Z',
  ageHours        => 2.25,
  hasCookie       => 1,
  hasCsrf         => 0,
  hasRefreshToken => 1,
  amazonPage      => 'amazon.de',
}, 'status normalization keeps public status fields only';

is_deeply FHEM::AlexaCookieService::State::normalize_status(undef), {}, 'non-hash status normalizes to empty hash';

my $cookie_export = FHEM::AlexaCookieService::State::normalize_cookie_export({
  localCookie      => 'cookie-data',
  csrf             => 'csrf-token',
  refreshToken     => 'refresh-token',
  macDms           => q{},
  serviceUpdatedAt => '2026-06-13T10:01:00.000Z',
});

is_deeply $cookie_export, {
  hasCookie        => 1,
  hasCsrf          => 1,
  hasRefreshToken  => 1,
  hasMacDms        => 0,
  serviceUpdatedAt => '2026-06-13T10:01:00.000Z',
}, 'cookie export normalization derives secret-free flags';

ok FHEM::AlexaCookieService::State::has_usable_cookie({
  hasCookie       => 1,
  hasCsrf         => 1,
  hasRefreshToken => 1,
}), 'usable cookie requires cookie, csrf and refresh token';

ok !FHEM::AlexaCookieService::State::has_usable_cookie({
  hasCookie       => 1,
  hasCsrf         => 1,
  hasRefreshToken => 0,
}), 'missing refresh token is not usable';

my $readings = FHEM::AlexaCookieService::State::readings_from_status({
  ok              => 1,
  updatedAt       => '2026-06-13T10:00:00.000Z',
  ageHours        => 0,
  hasCookie       => 1,
  hasCsrf         => 1,
  hasRefreshToken => 0,
  amazonPage      => 'amazon.de',
});

is_deeply $readings, {
  service_ok         => '1',
  service_updated_at => '2026-06-13T10:00:00.000Z',
  service_age_hours  => 0,
  cookie_available   => '1',
  csrf_available     => '1',
  refresh_available  => '0',
  amazon_page        => 'amazon.de',
}, 'readings keep zero age and expose string flags';

done_testing;
