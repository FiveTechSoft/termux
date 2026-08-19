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

$ch = curl_init($UPSTREAM . $path);
$headers = ['Content-Type: application/json'];
$auth = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
if ($auth !== '') $headers[] = 'Authorization: ' . $auth;

curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_CUSTOMREQUEST => $_SERVER['REQUEST_METHOD'],
  CURLOPT_HTTPHEADER => $headers,
  CURLOPT_TIMEOUT => 120,
]);

if ($_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'HEAD') {
  curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
}

$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$err = curl_error($ch);
curl_close($ch);

cors_headers();
if ($body === false) {
  http_response_code(502);
  header('Content-Type: application/json');
  echo json_encode(['error' => 'upstream error: ' . $err]);
  exit;
}

http_response_code($status ?: 502);
header('Content-Type: ' . ($ctype ?: 'application/json'));
echo $body;
