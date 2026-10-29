// Botão "Atualizar dados": dispara a tarefa agendada que recalcula o painel e mostra a situação dela.
// "atualizacao_status" lê a tarefa (get_trigger). "disparo" executa a tarefa (fire_trigger) e só é lido
// depois de um clique, com o parâmetro "gatilho" preenchido; sem ele, a chamada não tem tarefa e não roda.

const PF_TAREFA = 'trig_01BZVQxKYW7L9te3eK4QUYDj';

const pfLerResposta = (answer) => {
  const o = typeof answer === 'string' ? JSON.parse(answer) : answer;
  if (!o || typeof o !== 'object') throw new Error(String(answer));
  return o;
};

dash.loader('atualizacao_status', {
  description: 'A resposta da tarefa agendada como uma linha: quando rodou por último, se terminou bem e quando roda de novo.',
  fn: ({answer}) => {
    const o = pfLerResposta(answer), t = o.trigger || o, r = t.last_run || {};
    return [{ultima_execucao: r.fired_at || t.last_fired_at || null, terminou: r.finished_at || null,
      situacao: r.status ? String(r.status).replace('ROUTINE_RUN_STATUS_', '') : null, proxima: t.next_run_at || null, ativa: !!t.enabled}];
  },
});

dash.loader('disparo', {
  description: 'A resposta do disparo como uma linha: quando a tarefa foi iniciada.',
  fn: ({answer}) => {
    const o = pfLerResposta(answer), t = o.trigger || o;
    return [{disparado_em: t.last_fired_at || null, ok: true}];
  },
});

(() => {
  const btn = document.getElementById('pf-atualizar'), conf = document.getElementById('pf-atualizar-conf');
  const sim = document.getElementById('pf-atualizar-sim'), nao = document.getElementById('pf-atualizar-nao');
  const msg = document.getElementById('pf-atualizar-msg'), ver = document.getElementById('pf-atualizar-ver');
  let disparou = null;  // hora do clique nesta visita
  const quando = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', {weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '—';
  const SIT = {SUCCEEDED: 'concluída', FAILED: 'falhou', RUNNING: 'em andamento', PENDING: 'em andamento', QUEUED: 'em andamento'};

  btn.addEventListener('click', () => { conf.hidden = false; btn.hidden = true; });
  nao.addEventListener('click', () => { conf.hidden = true; btn.hidden = false; });
  sim.addEventListener('click', () => {
    conf.hidden = true; btn.hidden = false;
    disparou = new Date();
    dash.setParams({gatilho: PF_TAREFA});
    dash.refresh('disparo');
    desenhar();
  });
  ver.addEventListener('click', () => dash.refresh('atualizacao_status'));

  function desenhar() {
    const s = dash.data('atualizacao_status'), st = s.status === 'ok' ? s.data[0] : null;
    let texto = '';
    if (st) {
      const sit = SIT[st.situacao] || (st.situacao ? st.situacao.toLowerCase() : 'sem execuções');
      texto = `Última atualização: ${quando(st.ultima_execucao)} (${sit}) · Próxima automática: ${quando(st.proxima)}`;
      const andando = SIT[st.situacao] === 'em andamento';
      btn.disabled = andando || (disparou && Date.now() - disparou < 10 * 60e3);
      btn.textContent = andando ? 'Atualizando…' : 'Atualizar dados';
    } else if (s.status === 'connect' || s.status === 'declined') {
      texto = 'Para atualizar pelo painel, permita o acesso ao Claude Code Remote quando o painel pedir.';
    } else if (s.status === 'error') {
      texto = 'Não consegui ler a situação da atualização.';
    }
    if (disparou) {
      const d = dash.data('disparo');
      if (d.status === 'ok') {
        texto = `Atualização iniciada às ${disparou.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}. Leva cerca de 5 minutos; os números novos aparecem quando ela terminar (use "ver situação" para acompanhar).`;
        btn.disabled = true;
      } else if (d.status === 'error') {
        texto = 'Não consegui iniciar a atualização. Tente de novo em alguns minutos ou peça ao Claude no chat.';
        btn.disabled = false;
      } else if (d.status === 'loading' || d.refreshing) {
        texto = 'Iniciando a atualização…';
      }
    }
    msg.textContent = texto;
  }

  dash.onData(desenhar);
})();
