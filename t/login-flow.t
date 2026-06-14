use strict;
use warnings;

use Test::More;
use JSON::PP qw(decode_json);

my $json = qx(node -e "const { buildLoginFlowResponse } = require('./src/login-flow'); const response = buildLoginFlowResponse({ message: 'Please open http://example.invalid with your browser', proxyUrl: 'http://example.invalid', state: { ok: 1 } }); process.stdout.write(JSON.stringify(response));");
my $response = decode_json($json);

is $response->{error}, '', 'login flow responses clear stale errors';
is $response->{message}, 'Please open http://example.invalid with your browser', 'login flow responses keep message';
is $response->{proxyUrl}, 'http://example.invalid', 'login flow responses keep proxy URL';
is_deeply $response->{state}, { ok => 1 }, 'login flow responses preserve extra payload';

done_testing;
