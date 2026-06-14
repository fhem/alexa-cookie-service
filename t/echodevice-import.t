use strict;
use warnings;

use Test::More;

use FHEM::AlexaCookieService::EchodeviceImport;

is FHEM::AlexaCookieService::EchodeviceImport::export_name_for_hash({ NR => 696 }), "696result.json", "export name is derived from current FHEM NR";
is FHEM::AlexaCookieService::EchodeviceImport::export_name_for_hash({ NR => 0 }), "0result.json", "NR zero is accepted";

{
  no warnings "once";
  local $main::defs{EchoDeviceByName} = { NAME => "EchoDeviceByName", TYPE => "echodevice", NR => 77 };
  is FHEM::AlexaCookieService::EchodeviceImport::export_name_for_device("EchoDeviceByName"), "77result.json", "export name can be derived from device name";
}

is FHEM::AlexaCookieService::EchodeviceImport::export_name_for_hash({}), undef, "missing NR has no export name";
is FHEM::AlexaCookieService::EchodeviceImport::export_name_for_hash(undef), undef, "non-hash has no export name";

is FHEM::AlexaCookieService::EchodeviceImport::validate_target(undef), "missing echodevice hash", "validation rejects missing hash";
is FHEM::AlexaCookieService::EchodeviceImport::validate_target({ TYPE => "echodevice", NR => 1 }), "missing device name", "validation requires device name";
is FHEM::AlexaCookieService::EchodeviceImport::validate_target({ NAME => "Echo", TYPE => "dummy", NR => 1 }), "device is not an echodevice", "validation requires echodevice type";
is FHEM::AlexaCookieService::EchodeviceImport::validate_target({ NAME => "Echo", TYPE => "echodevice" }), "missing internal FHEM NR", "validation requires FHEM NR";
is FHEM::AlexaCookieService::EchodeviceImport::validate_target({ NAME => "Echo", TYPE => "echodevice", NR => 1 }), undef, "valid echodevice target passes validation";

my $called_with;
my $login_type_seen;
{
  no warnings "redefine";
  *main::echodevice_NPMWaitForCookie = sub {
    ($called_with) = @_;
    no warnings "once";
    $login_type_seen = $main::NPMLoginTyp;
    return;
  };
}

my $hash = { NAME => "Echo", TYPE => "echodevice", NR => 42 };
my $error = FHEM::AlexaCookieService::EchodeviceImport::trigger_import($hash, login_type => "external test");
is $error, undef, "trigger_import succeeds when echodevice import function exists";
is $called_with, $hash, "trigger_import passes target hash to echodevice";
is $login_type_seen, "external test", "trigger_import sets login type while calling echodevice";

{
  no warnings "once";
  local $main::defs{EchoImportByName} = { NAME => "EchoImportByName", TYPE => "echodevice", NR => 43 };
  $called_with = undef;
  $login_type_seen = undef;
  $error = FHEM::AlexaCookieService::EchodeviceImport::trigger_import_for_device("EchoImportByName", login_type => "external by name");
  is $error, undef, "trigger_import_for_device succeeds for echodevice name";
  is $called_with, $main::defs{EchoImportByName}, "trigger_import_for_device passes resolved target hash";
  is $login_type_seen, "external by name", "trigger_import_for_device forwards login type";
}

{
  no warnings "redefine";
  undef *main::echodevice_NPMWaitForCookie;
}

$error = FHEM::AlexaCookieService::EchodeviceImport::trigger_import($hash);
is $error, "echodevice_NPMWaitForCookie is not available", "trigger_import reports missing echodevice import function";

$error = FHEM::AlexaCookieService::EchodeviceImport::trigger_import_for_device(undef);
is $error, "missing echodevice name", "trigger_import_for_device reports missing name";

done_testing;
