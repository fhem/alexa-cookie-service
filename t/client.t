use strict;
use warnings;

use Test::More;

use FHEM::AlexaCookieService::Client;

my $client = FHEM::AlexaCookieService::Client->new(
  base_url => 'http://service.local:58080/',
  token    => 'secret-token',
  timeout  => 12,
);

my $status = $client->status_request;
is $status->{method}, 'GET', 'status request uses GET';
is $status->{url}, 'http://service.local:58080/api/status', 'status request trims trailing base URL slash';
is $status->{timeout}, 12, 'status request uses configured timeout';
is $status->{header}, 'x-auth-token: secret-token', 'status request includes auth token header';
ok exists $status->{callback}, 'request hash keeps callback key for HttpUtils';

my $refresh = $client->refresh_request(save => '696 result.json', timeout => 3);
is $refresh->{method}, 'POST', 'refresh request uses POST';
is $refresh->{url}, 'http://service.local:58080/api/cookie/refresh?save=696%20result.json', 'refresh request URL-encodes save parameter';
is $refresh->{timeout}, 3, 'request timeout can be overridden per request';

my $cookie = $client->cookie_request(save => '700result.json');
is $cookie->{url}, 'http://service.local:58080/api/cookie?save=700result.json', 'cookie request supports save parameter';

my $login_url = $client->login_url_request;
is $login_url->{url}, 'http://service.local:58080/api/cookie/login/url', 'login URL request uses canonical endpoint';

my $login_start = $client->login_start_request(data => '{"proxyPublicHost":"host"}');
is $login_start->{method}, 'POST', 'login start request uses POST';
is $login_start->{data}, '{"proxyPublicHost":"host"}', 'login start request passes optional request body';

my $cookie_text = $client->cookie_text_request;
is $cookie_text->{url}, 'http://service.local:58080/api/cookie/text', 'cookie text request uses canonical endpoint';

my $anonymous = FHEM::AlexaCookieService::Client->new;
my $anonymous_status = $anonymous->status_request;
ok !exists $anonymous_status->{header}, 'request omits header without token';
is $anonymous_status->{url}, 'http://alexa-cookie-service:58080/api/status', 'client uses default base URL';

my ($error, $decoded) = $client->decode_json_response(undef, '{"ok":true,"ageHours":1.5}');
is $error, undef, 'valid JSON has no parse error';
ok $decoded->{ok}, 'valid JSON boolean is true';
is $decoded->{ageHours}, 1.5, 'valid JSON numeric field is decoded';

($error, $decoded) = $client->decode_json_response('HTTP 500', '{"error":"boom"}');
is $error, 'HTTP 500', 'transport error is returned unchanged';
is $decoded, undef, 'transport error does not decode body';

($error, $decoded) = $client->decode_json_response(undef, q{});
is $error, 'empty response', 'empty JSON response is an error';
is $decoded, undef, 'empty JSON response has no decoded payload';

($error, $decoded) = $client->decode_json_response(undef, '{');
like $error, qr/.+/s, 'invalid JSON returns a parser error';
is $decoded, undef, 'invalid JSON has no decoded payload';

done_testing;
