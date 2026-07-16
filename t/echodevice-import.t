use strict;
use warnings;

use File::Temp qw(tempdir);
use File::Spec;
use JSON::PP qw(decode_json encode_json);
use Test::More;

use FHEM::AlexaCookieService::EchodeviceImport;

is FHEM::AlexaCookieService::EchodeviceImport::export_name_for_hash({ NR => 696 }), "696result.json", "export name is derived from current FHEM NR";
is FHEM::AlexaCookieService::EchodeviceImport::export_name_for_hash({ NR => 0 }), "0result.json", "NR zero is accepted";
is FHEM::AlexaCookieService::EchodeviceImport::export_name_for_hash({ NR => '../696' }), undef, "non-numeric NR is rejected";
is FHEM::AlexaCookieService::EchodeviceImport::export_path_for_hash({ NR => 696 }, export_dir => '/tmp/export-root'), '/tmp/export-root/696result.json', 'export path is derived from NR';


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
is FHEM::AlexaCookieService::EchodeviceImport::validate_target({ NAME => "Echo", TYPE => "echodevice", NR => '../1' }), "missing internal FHEM NR", "validation rejects non-numeric FHEM NR";
is FHEM::AlexaCookieService::EchodeviceImport::validate_target({ NAME => "Echo", TYPE => "echodevice", NR => 1 }), undef, "valid echodevice target passes validation";

my $tmpdir = tempdir(CLEANUP => 1);
my $export_dir = File::Spec->catdir($tmpdir, 'nested', 'exports');
my $target = { NAME => "Echo", TYPE => "echodevice", NR => 42 };
my $payload = {
  localCookie => 'cookie-data',
  csrf => 'csrf-token',
  refreshToken => 'refresh-token',
  macDms => 'mac-dms',
  formerRegistrationData => { foo => 'bar' },
};

my $error = FHEM::AlexaCookieService::EchodeviceImport::write_cookie_export($target, $payload, export_dir => $export_dir);
is $error, undef, "write_cookie_export succeeds for a valid target";
ok -f "$export_dir/42result.json", "cookie export file was created";

open my $fh, '<', "$export_dir/42result.json" or die $!;
local $/;
my $content = <$fh>;
close $fh;

ok $content !~ /\n/, "cookie export is written as compact JSON";
is_deeply decode_json($content), $payload, "cookie export round-trips through JSON";

my $from_json = FHEM::AlexaCookieService::EchodeviceImport::write_cookie_export($target, '{"localCookie":"text-cookie","csrf":"text-csrf"}', export_dir => $export_dir);
is $from_json, undef, "write_cookie_export accepts raw JSON strings";

my $invalid_payload = FHEM::AlexaCookieService::EchodeviceImport::write_cookie_export($target, "not-json", export_dir => $export_dir);
is $invalid_payload, "invalid cookie export payload", "write_cookie_export rejects invalid payloads";

my $bad_target = FHEM::AlexaCookieService::EchodeviceImport::write_cookie_export({ NAME => "Echo", TYPE => "echodevice", NR => '../42' }, $payload, export_dir => $export_dir);
is $bad_target, "missing internal FHEM NR", "write_cookie_export rejects unsafe targets";

{
  no warnings "once";
  local $main::defs{EchoByName} = { NAME => "EchoByName", TYPE => "echodevice", NR => 43 };
  my $by_name_error = FHEM::AlexaCookieService::EchodeviceImport::write_cookie_export_for_device("EchoByName", $payload, export_dir => $export_dir);
  is $by_name_error, undef, "write_cookie_export_for_device writes via device name";
  ok -f "$export_dir/43result.json", "device-name helper writes the expected file";
}

my $missing_dir = FHEM::AlexaCookieService::EchodeviceImport::write_cookie_export($target, $payload);
is $missing_dir, "missing export dir", "write_cookie_export requires an export dir";

my $missing_name = FHEM::AlexaCookieService::EchodeviceImport::write_cookie_export_for_device(undef, $payload, export_dir => $export_dir);
is $missing_name, "missing echodevice name", "write_cookie_export_for_device rejects missing names";

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

my $hash = { NAME => "Echo", TYPE => "echodevice", NR => 44 };
$error = FHEM::AlexaCookieService::EchodeviceImport::trigger_import($hash, login_type => "external test");
is $error, undef, "trigger_import succeeds when echodevice import function exists";
is $called_with, $hash, "trigger_import passes target hash to echodevice";
is $login_type_seen, "external test", "trigger_import sets login type while calling echodevice";

{
  no warnings "once";
  local $main::defs{EchoImportByName} = { NAME => "EchoImportByName", TYPE => "echodevice", NR => 45 };
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

{
  no warnings "redefine";
  *FHEM::AlexaCookieService::EchodeviceImport::trigger_import = sub {
    my ($hash_arg, %args) = @_;
    $called_with = $hash_arg;
    $login_type_seen = $args{login_type};
    return;
  };

  $called_with = undef;
  $login_type_seen = undef;
  my $combo_error = FHEM::AlexaCookieService::EchodeviceImport::write_cookie_export_and_trigger_import($target, $payload, export_dir => $tmpdir, login_type => 'combo');
  is $combo_error, undef, 'write_cookie_export_and_trigger_import writes and then imports';
  is $called_with, $target, 'combined helper forwards target to trigger_import';
  is $login_type_seen, 'combo', 'combined helper forwards trigger options';
}

{
  no warnings q{redefine};

  my @adapter_call;
  my @log_call;
  local *main::AttrVal = sub {
    my ($name, $attribute, $default) = @_;
    return q{EchoFromHTTPMOD}
      if $name eq q{AlexaCookieService} && $attribute eq q{echodevice};
    return $default;
  };
  local *main::Log3 = sub { @log_call = @_ };
  local *FHEM::AlexaCookieService::EchodeviceImport::write_cookie_export_and_trigger_import_for_device = sub {
    @adapter_call = @_;
    return;
  };

  my $httpmod_hash = { NAME => q{AlexaCookieService}, TYPE => q{HTTPMOD} };
  my $http_response = qq{HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n} . encode_json($payload);
  $error = FHEM::AlexaCookieService::EchodeviceImport::httpmod_write_cookie_export_and_trigger_import($httpmod_hash, $http_response);

  is $error, undef, q{HTTPMOD adapter accepts an export response};
  is $adapter_call[0], q{EchoFromHTTPMOD}, q{HTTPMOD adapter resolves the echodevice attribute};
  is_deeply $adapter_call[1], $payload, q{HTTPMOD adapter passes the decoded response payload};
  is_deeply [@adapter_call[2, 3]], [export_dir => q{/opt/fhem/cache/alexa-cookie}], q{HTTPMOD adapter uses the local FHEM export directory};
  is $log_call[1], 4, q{HTTPMOD adapter logs a successful import};

  @adapter_call = ();
  my $status_response = encode_json({ ok => 1, state => $payload });
  FHEM::AlexaCookieService::EchodeviceImport::httpmod_write_cookie_export_and_trigger_import($httpmod_hash, $status_response);
  is_deeply \@adapter_call, [], q{HTTPMOD adapter ignores status responses with nested state};
}

done_testing;
