use strict;
use warnings;

use Test::More;

use FHEM::AlexaCookieService::IntervalCheck;

sub codes {
  my ($findings) = @_;
  return join q{,}, map { $_->{code} } @{$findings};
}

my %good = (
  interval               => 3600,
  poll_delay             => 21600,
  timeout                => 60,
  npm_refresh_intervall  => 2592000,
  refresh_min_age_hours  => 6,
);

my $findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good);
is codes($findings), q{}, 'recommended setup has no findings';
is FHEM::AlexaCookieService::IntervalCheck::overall_level($findings), 'ok', 'recommended setup is ok';
is FHEM::AlexaCookieService::IntervalCheck::summary($findings), 'ok', 'summary of recommended setup';

$findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, interval => 0);
is codes($findings), 'INTERVAL_INVALID', 'zero interval is invalid';

$findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, poll_delay => 'x6');
is codes($findings), 'POLLDELAY_X_FORM,EXPORT_MORE_OFTEN_THAN_REFRESH', 'x form is flagged because HTTPMOD evaluates it as 0';

$findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, poll_delay => 'soon');
is codes($findings), 'POLLDELAY_INVALID,EXPORT_MORE_OFTEN_THAN_REFRESH', 'non numeric delay is invalid';

$findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, poll_delay => 3600);
is codes($findings), 'POLLDELAY_REDUNDANT,EXPORT_MORE_OFTEN_THAN_REFRESH', 'delay equal to interval is redundant';

$findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, poll_delay => undef);
is codes($findings), 'EXPORT_MORE_OFTEN_THAN_REFRESH', 'hourly export without delay is reported';

$findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, interval => 57600, poll_delay => 57600);
is codes($findings), 'POLLDELAY_REDUNDANT', 'long interval with equal delay is redundant but valid';

$findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, poll_delay => 22000);
is codes($findings), q{}, 'delay is rounded up to a multiple of the interval';

$findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, npm_refresh_intervall => undef);
is codes($findings), 'NPM_REFRESH_UNSET', 'unset npm_refresh_intervall warns';
is FHEM::AlexaCookieService::IntervalCheck::overall_level($findings), 'warning', 'unset npm_refresh_intervall is a warning';

$findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, npm_refresh_intervall => 6000);
is codes($findings), 'NPM_REFRESH_TOO_LOW', 'npm_refresh_intervall below import spacing is an error';
is FHEM::AlexaCookieService::IntervalCheck::summary($findings), 'error: NPM_REFRESH_TOO_LOW', 'summary lists error codes';

$findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, npm_refresh_intervall => 43200);
is codes($findings), 'NPM_REFRESH_BELOW_RECOMMENDED', 'npm_refresh_intervall above spacing but low warns';

$findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, timeout => 30);
is codes($findings), 'TIMEOUT_LOW', 'short timeout warns';

$findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, refresh_min_age_hours => undef);
is codes($findings), 'SERVICE_VALUES_UNKNOWN', 'missing service value is reported as info';
is FHEM::AlexaCookieService::IntervalCheck::overall_level($findings), 'ok', 'info does not raise the level';

$findings = FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, export_polled => 0);
is codes($findings), 'EXPORT_NOT_POLLED', 'export outside the update cycle is reported';

like FHEM::AlexaCookieService::IntervalCheck::report(
  FHEM::AlexaCookieService::IntervalCheck::check_intervals(%good, timeout => 30)
), qr/\Ainterval check: warning\nWARNING TIMEOUT_LOW: /, 'report lists level and code';
is FHEM::AlexaCookieService::IntervalCheck::report([]), "interval check: ok\n", 'empty report is ok';

# FHEM device helpers
{
  no warnings 'once';
  local %main::defs = (
    acs => { Interval => 3600 },
  );
  local %main::attr = (
    acs => {
      get01Name      => 'status',
      get03Name      => 'exportCookie',
      get03Poll      => 1,
      get03PollDelay => 21600,
      timeout        => 60,
    },
    echo => { npm_refresh_intervall => 2592000 },
  );
  no warnings 'redefine';
  local *main::ReadingsVal = sub { return $_[0] eq 'acs' && $_[1] eq 'service_refresh_min_age_hours' ? 6 : $_[2] };
  local *main::AttrVal = sub {
    my ($name, $attr, $default) = @_;
    return exists $main::attr{$name}{$attr} ? $main::attr{$name}{$attr} : $default;
  };

  is FHEM::AlexaCookieService::IntervalCheck::summary_for_devices('acs', 'echo', refresh_min_age_hours => 6),
    'ok', 'device helper reads attributes of HTTPMOD and echodevice';

  $main::attr{acs}{get03PollDelay} = 'x6';
  is FHEM::AlexaCookieService::IntervalCheck::summary_for_devices('acs', 'echo', refresh_min_age_hours => 6),
    'warning: POLLDELAY_X_FORM', 'device helper detects the x form';

  delete $main::attr{echo}{npm_refresh_intervall};
  $main::attr{acs}{get03PollDelay} = 21600;
  is FHEM::AlexaCookieService::IntervalCheck::summary_for_devices('acs', 'echo', refresh_min_age_hours => 6),
    'warning: NPM_REFRESH_UNSET', 'device helper detects unset npm_refresh_intervall';

  is FHEM::AlexaCookieService::IntervalCheck::summary_for_devices('acs', 'echo'),
    'warning: NPM_REFRESH_UNSET', 'device helper takes the minimum age from the reading';

  $main::attr{acs}{get03Poll} = 0;
  my $args = FHEM::AlexaCookieService::IntervalCheck::args_for_devices('acs', 'echo');
  is $args->{export_polled}, 0, 'device helper reports export outside the update cycle';
}

done_testing;
