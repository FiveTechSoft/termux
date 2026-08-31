<?php
/* =====================================================================
   OpenCode Zen CORS proxy — fivetechsoft.com
   Forwards /zenproxy/<path> to https://opencode.ai/<path> and adds CORS
   headers so the Termux Web static site (GitHub Pages) can call the
   Zen API. Egress uses this server's IP (fresh free-tier quota).
   ===================================================================== */

$UPSTREAM = 'https://opencode.ai';
$ALLOW_ORIGIN = 'https://fivetechsoft.github.io';

function cors_headers() {
  global $ALLOW_ORIGIN;
  header('Access-Control-Allow-Origin: ' . $ALLOW_ORIGIN);
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  header('Access-Control-Allow-Headers: Authorization, Content-Type');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  cors_headers();
  http_response_code(204);
  exit;
}

/* Path after /zenproxy (main domain) or the URI itself (subdomain docroot) */
$uri = $_SERVER['REQUEST_URI'];
$pos = strpos($uri, '/zenproxy');
if ($pos === false) {
  $path = $uri;
} else {
  $path = substr($uri, $pos + strlen('/zenproxy'));
  if ($path === '' || $path === false) $path = '/';
  if (strpos($path, '/index.php') === 0) $path = substr($path, strlen('/index.php')) ?: '/';
}
$qpos = strpos($path, '?');
if ($qpos !== false) $path = substr($path, 0, $qpos);

/* Only allow forwarding inside /zen/ */
if (strpos($path, '/zen/') !== 0) {
  cors_headers();
  http_response_code(404);
  header('Content-Type: application/json');
  echo json_encode(['error' => 'not found']);
  exit;
}

$input = ($_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'HEAD')
  ? file_get_contents('php://input') : '';
$decoded = $input !== '' ? json_decode($input, true) : null;
$wantsStream = is_array($decoded) && !empty($decoded['stream']);

$ch = curl_init($UPSTREAM . $path);
$headers = ['Content-Type: application/json'];
$auth = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
if ($auth !== '') $headers[] = 'Authorization: ' . $auth;

curl_setopt_array($ch, [
  CURLOPT_CUSTOMREQUEST => $_SERVER['REQUEST_METHOD'],
  CURLOPT_HTTPHEADER => $headers,
  CURLOPT_TIMEOUT => 180,
]);
if ($input !== '') curl_setopt($ch, CURLOPT_POSTFIELDS, $input);

cors_headers();
if ($wantsStream) {
  header('Content-Type: text/event-stream');
  header('Cache-Control: no-cache, no-transform');
  header('X-Accel-Buffering: no');
  if (function_exists('apache_setenv')) { @apache_setenv('no-gzip', '1'); }
  while (ob_get_level()) { @ob_end_flush(); }
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
  curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $data) {
    echo $data;
    @flush();
    return strlen($data);
  });
  $ok = curl_exec($ch);
  $err = curl_error($ch);
  curl_close($ch);
  if ($ok === false && $err) {
    echo 'data: ' . json_encode(['error' => ['message' => $err]]) . "\n\n";
  }
  exit;
}

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$err = curl_error($ch);
curl_close($ch);

if ($body === false) {
  http_response_code(502);
  header('Content-Type: application/json');
  echo json_encode(['error' => 'upstream error: ' . $err]);
  exit;
}

http_response_code($status ?: 502);
header('Content-Type: ' . ($ctype ?: 'application/json'));
echo $body;
