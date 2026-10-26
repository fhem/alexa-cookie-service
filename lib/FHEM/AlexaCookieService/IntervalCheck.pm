# $Id$
#
# Maintainer: sidey
# Description: Compatibility check for the polling intervals of the HTTPMOD, echodevice and service setup.
# More information: https://github.com/fhem/alexa-cookie-service

package FHEM::AlexaCookieService::IntervalCheck;

use strict;
use warnings;

use POSIX qw(ceil);

# echodevice falls back to a local NPM refresh when `.COOKIE` is older than
# `npm_refresh_intervall` (default 6000 s). That refresh does not exist in an
# ACS setup and only produces log errors, so the attribute is set high enough to
# never fire.
use constant NPM_REFRESH_DEFAULT     => 6000;
use constant NPM_REFRESH_MINIMUM     => 604800;
use constant NPM_REFRESH_RECOMMENDED => 2592000;

# /api/status refreshes synchronously, so the HTTPMOD timeout has to cover it.
use constant TIMEOUT_RECOMMENDED => 60;

use constant EXPORT_GET_NAME => 'exportCookie';

sub check_intervals {
  my (%args) = @_;
  my @findings;
  my $add = sub {
    my ($level, $code, $message) = @_;
    push @findings, { level => $level, code => $code, message => $message };
  };

  my $interval = _number($args{interval});
  if (!defined $interval || $interval <= 0) {
    $add->('error', 'INTERVAL_INVALID', 'HTTPMOD interval is missing or not a positive number of seconds');
    return \@findings;
  }

  # Time between two exportCookie requests, which is also the time between two
  # imports into echodevice.
  my $export_spacing = $interval;
  my $export_polled = exists $args{export_polled} ? $args{export_polled} : 1;
  my $delay = $args{poll_delay};

  if (!$export_polled) {
    $add->('info', 'EXPORT_NOT_POLLED',
      qq[get ${\ EXPORT_GET_NAME} is not part of the update cycle (Poll 1), echodevice only gets the cookie on manual get]);
  }
  elsif (defined $delay && $delay ne q{}) {
    if ($delay =~ /\Ax\d+\z/i) {
      $add->('warning', 'POLLDELAY_X_FORM',
        qq[PollDelay "$delay" is documented by HTTPMOD but evaluated numerically as 0, so every interval requests the export; use seconds instead]);
    }
    elsif (!defined _number($delay)) {
      $add->('error', 'POLLDELAY_INVALID', qq[PollDelay "$delay" is not a number of seconds]);
    }
    elsif ($delay <= $interval) {
      $add->('info', 'POLLDELAY_REDUNDANT',
        qq[PollDelay $delay s is not larger than the interval $interval s and has no effect]);
    }
    else {
      $export_spacing = ceil($delay / $interval) * $interval;
    }
  }

  my $min_age_hours = _number($args{refresh_min_age_hours});
  if (defined $min_age_hours && $min_age_hours > 0) {
    my $min_age = $min_age_hours * 3600;

    # The service refreshes at the earliest after the minimum age, so an export
    # more often than that only repeats unchanged state.
    if ($export_polled && $export_spacing < $min_age) {
      $add->('info', 'EXPORT_MORE_OFTEN_THAN_REFRESH',
        qq[exportCookie runs every $export_spacing s but the service refreshes at the earliest after $min_age s; set PollDelay to $min_age to avoid unchanged imports]);
    }
  }
  else {
    $add->('info', 'SERVICE_VALUES_UNKNOWN',
      'REFRESH_MIN_AGE_HOURS of the service is unknown, refresh cadence was not checked');
  }

  my $npm = _number($args{npm_refresh_intervall});
  if (!defined $npm) {
    $add->('warning', 'NPM_REFRESH_UNSET',
      sprintf('echodevice npm_refresh_intervall is not set (default %d s), echodevice then tries a local NPM refresh and logs errors; set it to %d',
        NPM_REFRESH_DEFAULT, NPM_REFRESH_RECOMMENDED));
  }
  elsif ($npm <= $export_spacing + $interval) {
    $add->('error', 'NPM_REFRESH_TOO_LOW',
      sprintf('echodevice npm_refresh_intervall %d s is not above the import spacing %d s, echodevice tries a local NPM refresh between imports and logs errors; set it to %d',
        $npm, $export_spacing, NPM_REFRESH_RECOMMENDED));
  }
  elsif ($npm < NPM_REFRESH_MINIMUM) {
    $add->('warning', 'NPM_REFRESH_BELOW_RECOMMENDED',
      sprintf('echodevice npm_refresh_intervall %d s is low, a few missed imports make echodevice try a local NPM refresh; set it to %d',
        $npm, NPM_REFRESH_RECOMMENDED));
  }

  my $timeout = _number($args{timeout});
  if (defined $timeout && $timeout < TIMEOUT_RECOMMENDED) {
    $add->('warning', 'TIMEOUT_LOW',
      sprintf('HTTPMOD timeout %d s may be shorter than a refresh, because /api/status refreshes synchronously; set it to at least %d',
        $timeout, TIMEOUT_RECOMMENDED));
  }

  return \@findings;
}

sub overall_level {
  my ($findings) = @_;

  return 'error' if grep { $_->{level} eq 'error' } @{$findings || []};
  return 'warning' if grep { $_->{level} eq 'warning' } @{$findings || []};
  return 'ok';
}

sub summary {
  my ($findings) = @_;

  my $level = overall_level($findings);
  return 'ok' if $level eq 'ok';

  my @codes = map { $_->{code} } grep { $_->{level} eq $level } @{$findings};
  return $level . q{: } . join q{, }, @codes;
}

sub report {
  my ($findings) = @_;

  return qq[interval check: ok\n] if !@{$findings || []};

  my @lines = map { sprintf '%-7s %s: %s', uc $_->{level}, $_->{code}, $_->{message} } @{$findings};
  return join(qq[\n], qq[interval check: ] . overall_level($findings), @lines) . qq[\n];
}

# FHEM helpers: collect the settings from the HTTPMOD and echodevice devices.

sub args_for_devices {
  my ($httpmod_name, $echodevice_name, %extra) = @_;

  my $hash = $main::defs{$httpmod_name};
  my %args = (
    interval              => ref $hash eq 'HASH' ? $hash->{Interval} : undef,
    timeout               => main::AttrVal($httpmod_name, 'timeout', 2),
    npm_refresh_intervall => main::AttrVal($echodevice_name, 'npm_refresh_intervall', undef),
    export_polled         => 0,
    refresh_min_age_hours => main::ReadingsVal($httpmod_name, 'service_refresh_min_age_hours', undef),
    %extra,
  );

  my $attrs = $main::attr{$httpmod_name};
  for my $key (sort keys %{ ref $attrs eq 'HASH' ? $attrs : {} }) {
    next if $key !~ /\Aget(\d+)Name\z/;
    my $number = $1;
    next if $attrs->{$key} ne EXPORT_GET_NAME;

    $args{export_polled} = main::AttrVal($httpmod_name, "get${number}Poll", 0) ? 1 : 0;
    $args{poll_delay} = main::AttrVal($httpmod_name, "get${number}PollDelay", undef);
    last;
  }

  return \%args;
}

sub check_for_devices {
  my ($httpmod_name, $echodevice_name, %extra) = @_;

  return check_intervals(%{ args_for_devices($httpmod_name, $echodevice_name, %extra) });
}

sub summary_for_devices {
  my ($httpmod_name, $echodevice_name, %extra) = @_;

  return summary(check_for_devices($httpmod_name, $echodevice_name, %extra));
}

sub report_for_devices {
  my ($httpmod_name, $echodevice_name, %extra) = @_;

  return report(check_for_devices($httpmod_name, $echodevice_name, %extra));
}

sub _number {
  my ($value) = @_;

  return undef if !defined $value;
  return $value + 0 if $value =~ /\A\s*\d+(?:\.\d+)?\s*\z/;
  return undef;
}

1;
