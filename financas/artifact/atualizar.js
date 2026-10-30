// Barra do topo: quando os dados foram atualizados e como rodar a atualização na hora.
// O painel não consegue disparar a tarefa agendada (o tipo Dashboard só consulta conectores de dados),
// então o botão mostra o caminho para rodar a tarefa pelo menu Agendados do Claude.

(() => {
  const btn = document.getElementById('pf-atualizar'), box = document.getElementById('pf-atualizar-como');
  const msg = document.getElementById('pf-atualizar-msg');
  btn.addEventListener('click', () => {
    box.hidden = !box.hidden;
    btn.setAttribute('aria-expanded', String(!box.hidden));
  });

  dash.onData(() => {
    const d = dash.data('atualizacao'), r = d.status === 'ok' ? d.data[0] : null;
    if (!r) { msg.textContent = d.status === 'error' ? 'Não consegui ler a data da última atualização.' : ''; return; }
    const quando = new Date(r.gerado_em);
    const dias = Math.floor((Date.now() - quando) / 864e5);
    msg.textContent = `Dados atualizados em ${quando.toLocaleString('pt-BR', {weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}`
      + (dias >= 1 ? ` (há ${dias} ${dias === 1 ? 'dia' : 'dias'})` : '') + ' · atualização automática todo domingo às 04h34';
  });
})();
