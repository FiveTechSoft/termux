<?php
/* =====================================================================
   webfetch — outbound fetch proxy for FiveTech Agent (GitHub Pages)
   GET /webfetch.php?url=<http(s) URL>  ->  raw body with CORS headers.
   Only GET, only http/https, no private/loopback hosts. Cap 30 KB.
   ===================================================================== */

$ALLOW_ORIGIN = 'https://fivetechsoft.github.io';
$MAX = 30000;

function cors_headers() {
  global $ALLOW_ORIGIN;
  header('Access-Control-Allow-Origin: ' . $ALLOW_ORIGIN);
  header('Access-Control-Allow-Methods: GET, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  cors_headers();
  http_response_code(204);
  exit;
}

cors_headers();
header('Content-Type: text/plain; charset=utf-8');

$url = isset($_GET['url']) ? $_GET['url'] : '';
$parts = parse_url($url);
if (!$parts || !isset($parts['scheme']) || !in_array($parts['scheme'], ['http', 'https'], true) || empty($parts['host'])) {
  http_response_code(400);
  echo 'Error: invalid or missing url parameter (only http/https)';
  exit;
}

/* block loopback/private hosts */
$host = $parts['host'];
$ip = gethostbyname($host);
if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
  http_response_code(403);
  echo 'Error: host not allowed';
  exit;
}

$ch = curl_init($url);
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_FOLLOWLOCATION => true,
  CURLOPT_MAXREDIRS => 3,
  CURLOPT_TIMEOUT => 25,
  CURLOPT_USERAGENT => 'FiveTechAgent/1.0 (+https://fivetechsoft.github.io/termux/agent.html)',
  CURLOPT_ENCODING => '',
]);
$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$err = curl_error($ch);
curl_close($ch);

if ($body === false) {
  http_response_code(502);
  echo 'Error: fetch failed: ' . $err;
  exit;
}

http_response_code($status >= 200 && $status < 600 ? $status : 502);
echo substr($body, 0, $MAX);
if (strlen($body) > $MAX) echo "\n[output truncated]";
