###############################################################################
# Minimal loader for alexa-cookie-service Perl packages in FHEM.
#
# Copy the FHEM::AlexaCookieService::* package files below /opt/fhem/lib first:
#   /opt/fhem/lib/FHEM/AlexaCookieService/Client.pm
#   /opt/fhem/lib/FHEM/AlexaCookieService/EchodeviceImport.pm
#   /opt/fhem/lib/FHEM/AlexaCookieService/State.pm
#
# Then add these lines to an existing 99_myUtils.pm, or create a small
# 99_myUtils_alexa_cookie_service.pm with this content and reload it.
###############################################################################

use lib q{/opt/fhem/lib};
use FHEM::AlexaCookieService::EchodeviceImport;

1;
