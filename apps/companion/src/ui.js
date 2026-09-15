const $ = (id) => document.getElementById(id);
let busy = false;
async function refresh() {
  const state = await window.porch.state();
  $('connection').textContent = state.connection;
  $('setup').textContent = state.setup;
  if (document.activeElement !== $('origin')) $('origin').value = state.origin;
  $('pair-form').hidden = state.paired;
  $('paired').hidden = !state.paired;
  $('executable-path').textContent = state.executable ?? 'No executable selected.';
  $('login-item').checked = state.startAtLogin;
  $('projects').replaceChildren(
    ...state.projects.map((p) => {
      const li = document.createElement('li'),
        strong = document.createElement('strong'),
        small = document.createElement('small');
      strong.textContent = p.label;
      small.textContent = p.path;
      const repair = document.createElement('button');
      repair.className = 'secondary';
      repair.textContent = 'Repair folder…';
      repair.addEventListener('click', () => act(() => window.porch.repairProject(p.localId)));
      li.append(strong, small, repair);
      return li;
    }),
  );
}
async function act(fn) {
  if (busy) return;
  busy = true;
  $('error').hidden = true;
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (error) {
    $('error').textContent = error.message.replace(
      /^Error invoking remote method '[^']+': Error: /,
      '',
    );
    $('error').hidden = false;
  } finally {
    busy = false;
    document.querySelectorAll('button').forEach((b) => (b.disabled = false));
    await refresh();
  }
}
$('pair-form').addEventListener('submit', (e) => {
  e.preventDefault();
  act(async () => {
    await window.porch.pair({ origin: $('origin').value, token: $('token').value.trim() });
    $('token').value = '';
  });
});
$('project-form').addEventListener('submit', (e) => {
  e.preventDefault();
  act(() => window.porch.project({ label: $('project-label').value }));
});
for (const [button, method] of Object.entries({
  install: 'install',
  executable: 'executable',
  signin: 'signin',
  check: 'check',
  connect: 'connect',
  disconnect: 'disconnect',
  forget: 'forget',
  'open-chat': 'openChat',
}))
  $(button).addEventListener('click', () => act(() => window.porch[method]()));
$('login-item').addEventListener('change', () =>
  act(() => window.porch.loginItem($('login-item').checked)),
);
window.porch.onChange(() =>
  refresh().catch((error) => {
    $('error').hidden = false;
    $('error').textContent = error.message;
  }),
);
refresh().catch((error) => {
  $('error').hidden = false;
  $('error').textContent = error.message;
});
