(function () {
  const { api, esc, $ } = window.BG;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/teacher/login', { email: $('#email').value, password: $('#password').value });
      location.reload();
    } catch (err) {
      $('#loginMsg').innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    }
  });
})();
