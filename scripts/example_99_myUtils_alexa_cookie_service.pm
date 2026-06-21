###############################################################################
# Minimal loader and local import helper for alexa-cookie-service packages.
#
# Copy the FHEM::AlexaCookieService::* package files below /opt/fhem/lib first:
#   /opt/fhem/lib/FHEM/AlexaCookieService/Client.pm
#   /opt/fhem/lib/FHEM/AlexaCookieService/EchodeviceImport.pm
#   /opt/fhem/lib/FHEM/AlexaCookieService/State.pm
#
# Then add this file as 99_myUtils_alexa_cookie_service.pm or merge the content
# into an existing 99_myUtils.pm and reload it.
#
# The helper below is intended for the HTTPMOD flow. It writes the /api/cookie
# response locally in the FHEM container and then triggers the existing
# echodevice import path.
###############################################################################

use lib q{/opt/fhem/lib};
use FHEM::AlexaCookieService::EchodeviceImport;

sub AlexaCookieService_writeAndImport {
  my ($echodevice, $payload, $export_dir) = @_;

  return q[missing echodevice name] if !$echodevice;
  return q[missing cookie export payload] if !defined $payload || $payload eq q{};

  $export_dir ||= q[/opt/fhem/cache/alexa-cookie];

  return FHEM::AlexaCookieService::EchodeviceImport::write_cookie_export_and_trigger_import_for_device(
    $echodevice,
    $payload,
    export_dir => $export_dir,
  );
}

1;
