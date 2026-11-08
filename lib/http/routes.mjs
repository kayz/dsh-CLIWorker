// The jobs template requires expansion to a concrete exact path by the host integration.
export const routes = Object.freeze([
  { method: 'POST', path: '/cliworker/select', level: 'select' },
  { method: 'GET', path: '/cliworker/api/session', level: 'bootstrap' },
  { method: 'GET', path: '/cliworker/ui', level: 'bootstrap' },
  { method: 'GET', path: '/cliworker/health', level: 'public' },
  ...['providers', 'models', 'forecast', 'api/snapshot', 'api/jobs/<id>'].map((path) =>
    ({ method: 'GET', path: `/cliworker/${path}`, level: 'admin_read' })),
  ...['discover', 'enumerate', 'probe', 'read-usage', 'allow', 'deny', 'level', 'alias', 'manual-model', 'pool', 'secret'].map((path) =>
    ({ method: 'POST', path: `/cliworker/api/${path}`, level: 'admin_write' })),
].map(Object.freeze))
