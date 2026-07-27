// Every setting comes from the environment so that no host name, user id, or
// password is ever committed. Defaults point at example.com and will fail fast.

function env(name, fallback) {
  const value = __ENV[name];
  return value === undefined || value === '' ? fallback : value;
}

export const zosmf = {
  url: env('ZOSMF_URL', 'https://zosmf.example.com'),
  user: env('ZOS_USER', 'IBMUSER'),
  password: env('ZOS_PASSWORD', ''),
  consoleName: env('ZOSMF_CONSOLE', 'defcn'),
};

export const zos = {
  hlq: env('ZOS_HLQ', env('ZOS_USER', 'IBMUSER')),
  account: env('ZOS_ACCOUNT', 'ACCT#'),
  jobClass: env('ZOS_JOB_CLASS', 'A'),
  msgClass: env('ZOS_MSG_CLASS', 'H'),
  ussDir: env('ZOS_USS_DIR', '/tmp'),
};

export const tn3270 = {
  host: env('TN3270_HOST', 'localhost'),
  port: parseInt(env('TN3270_PORT', '2023'), 10),
  model: parseInt(env('TN3270_MODEL', '2'), 10),
  codePage: env('TN3270_CODEPAGE', 'cp037'),
  tls: env('TN3270_TLS', 'false') === 'true',
  user: env('TN3270_USER', 'IBMUSER'),
  password: env('TN3270_PASSWORD', 'SYS1'),
};

export const ssh = {
  host: env('ZOS_SSH_HOST', 'zos.example.com'),
  port: parseInt(env('ZOS_SSH_PORT', '22'), 10),
  user: env('ZOS_USER', 'IBMUSER'),
  password: env('ZOS_PASSWORD', ''),
  rsaKey: env('ZOS_SSH_KEY', ''),
  passphrase: env('ZOS_SSH_PASSPHRASE', ''),
};

// ZOAU installs under a versioned path. `zoau` on PATH is the common setup, but
// batch SSH sessions often start without the login profile, so scripts prefix
// commands with this instead of assuming PATH.
export const zoau = {
  home: env('ZOAU_HOME', '/usr/lpp/IBM/zoau'),
  pythonPath: env('ZOAU_PYTHONPATH', '/usr/lpp/IBM/zoau/lib'),
};

export const insecureTLS = env('ZOS_TLS_INSECURE', 'false') === 'true';

export function requireCredentials() {
  if (!zosmf.password) {
    throw new Error('ZOS_PASSWORD is not set. Export it or use --secret-source.');
  }
}
