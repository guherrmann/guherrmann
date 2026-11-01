// Aba Plano: aportes previstos × sobra realizada, metas de corte e dinheiro parado em conta.

dash.calc('plano_calc', {
  inputs: ['plano', 'plano_resumo'],
  title: 'Situação do plano',
  description: 'Aporte acumulado previsto até o mês atual (aporte inicial + aportes mensais) contra o realizado (aporte inicial + sobra de cada mês), meses fechados e dinheiro parado em conta acima do que fica para as contas.',
  fn: (plano, plano_resumo) => {
    const r = plano_resumo[0] || {};
    const correntes = plano.filter((p) => p.situacao !== 'futuro');
    const fechados = plano.filter((p) => p.situacao === 'fechado');
    const ult = correntes[correntes.length - 1], ultFechado = fechados[fechados.length - 1];
    const final = plano[plano.length - 1];
    // Compara só meses fechados: o mês em andamento ainda está parcial.
    const prevAte = ultFechado ? ultFechado.acumulado_prev : r.aporte_inicial || 0, realAte = ultFechado ? ultFechado.acumulado_real : r.aporte_inicial || 0;
    const sobraMedia = fechados.length ? fechados.reduce((s, p) => s + p.sobra_real, 0) / fechados.length : null;
    const aporteMedio = fechados.length ? fechados.reduce((s, p) => s + p.aporte_prev, 0) / fechados.length : null;
    return [{mes_atual: ult ? ult.mes : null, ultimo_fechado: ultFechado ? ultFechado.mes : null, meses_fechados: fechados.length, meses_total: plano.length,
      acumulado_prev: prevAte, acumulado_real: realAte, diferenca: realAte - prevAte, ritmo: prevAte ? Math.round(realAte / prevAte * 100) : null,
      sobra_media: sobraMedia, aporte_medio_prev: aporteMedio, parado_em_conta: r.parado_em_conta, fica_na_conta: r.fica_na_conta,
      saldo_final_prev: final ? final.saldo_prev : null, mes_final: final ? final.mes : null}];
  },
});

dash.calc('plano_metas_resumo', {
  inputs: ['plano_metas'],
  title: 'Metas de corte: este mês e média',
  description: 'Gasto em cada categoria com meta no mês atual, na média dos meses fechados do plano e na média dos 12 meses antes do plano.',
  fn: (plano_metas) => {
    const cats = [...new Set(plano_metas.map((m) => m.categoria))];
    return cats.map((c) => {
      const l = plano_metas.filter((m) => m.categoria === c);
      const atual = l.find((m) => m.situacao === 'em andamento');
      const fech = l.filter((m) => m.situacao === 'fechado');
      return {categoria: c, meta: l[0].meta, mes_atual: atual ? atual.real : null,
        media_fechados: fech.length ? fech.reduce((s, m) => s + m.real, 0) / fech.length : null, antes: l[0].media_antes ?? null};
    });
  },
});

(() => {
  const F = window.pfFmt;
  const el = (tag, attrs, text) => { const e = document.createElement(tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); if (text != null) e.textContent = text; return e; };
  const brl = (v) => v == null ? '—' : F.brl(v);
  const sinal = (v) => v == null ? '—' : (v >= 0 ? '+' : '−') + F.brl(Math.abs(v));
  const visivel = () => !document.getElementById('plano').hidden;
  document.querySelector('.pf').style.setProperty('--pf-c0', dash.colors[0]);

  function kpis() {
    const d = dash.data('plano_calc'), host = document.getElementById('pl-kpis'), take = document.getElementById('pl-take');
    if (d.status !== 'ok' || !d.data[0]) { host.replaceChildren(); return; }
    const k = d.data[0];
    const card = (l, v, field, det, st) => {
      const c = el('div', {class: 'pf-card pf-kpi'});
      c.append(el('div', {class: 'l'}, l), el('div', {class: 'v', 'data-source': 'plano_calc', 'data-field': field, 'data-row': '0'}, v), el('div', {class: 'd'}, det));
      if (st) c.append(el('div', {class: 'pf-st ' + st[0]}, st[1]));
      return c;
    };
    const noRitmo = k.diferenca >= -50;
    host.replaceChildren(
      card('Aportado até agora', brl(k.acumulado_real), 'acumulado_real', k.ultimo_fechado ? `previsto ${brl(k.acumulado_prev)} até ${F.mes(k.ultimo_fechado)}` : 'aporte inicial; meses fechados entram aqui', k.meses_fechados ? (noRitmo ? ['good', '✓ No ritmo'] : ['warning', `! ${sinal(k.diferenca)} do previsto`]) : null),
      card('Sobra média por mês', k.sobra_media == null ? '—' : brl(k.sobra_media), 'sobra_media', k.sobra_media == null ? 'aparece quando o 1º mês fechar' : `aporte previsto médio ${brl(k.aporte_medio_prev)}`),
      card('Parado em conta', brl(k.parado_em_conta), 'parado_em_conta', `acima dos ${brl(k.fica_na_conta)} que ficam no Santander`, k.parado_em_conta > 1000 ? ['warning', '! Aplicar em liquidez diária'] : ['good', '✓ Nada parado']),
      card(`Meta para ${F.mes(k.mes_final || '')}`, brl(k.saldo_final_prev), 'saldo_final_prev', 'saldo projetado com juros, reserva de ~4 meses'),
    );
    take.textContent = `Mês ${k.meses_fechados + 1} de ${k.meses_total}. ` + (k.meses_fechados ? (noRitmo ? 'Você está no ritmo do plano.' : `Faltam ${F.brl(-k.diferenca)} para o previsto até aqui.`) : 'O plano começou agora: aplique o aporte inicial e acompanhe a sobra de cada mês aqui.');
  }

  function tabela() {
    const d = dash.data('plano'), tb = document.querySelector('#pl-tab tbody');
    if (d.status !== 'ok') { tb.replaceChildren(); return; }
    const r = dash.data('plano_resumo');
    const ini = r.status === 'ok' && r.data[0] ? r.data[0] : null;
    document.getElementById('pl-ini').textContent = ini ? `Aporte inicial: ${F.brl(ini.aporte_inicial)} (sobras das contas e venda dos FIIs). Valores realizados do mês em andamento são parciais.` : '';
    tb.replaceChildren(...d.data.map((p) => {
      const tr = el('tr', {});
      if (p.situacao === 'em andamento') tr.className = 'pl-atual';
      const par = (prev, real, inverso) => {
        const td = el('td', {class: 'n'});
        td.append(el('div', {}, brl(prev)));
        if (real != null) {
          const ok = inverso ? real <= prev : real >= prev;
          td.append(el('div', {class: 'sub ' + (p.situacao === 'fechado' ? (ok ? 'iv-pos' : 'iv-neg') : '')}, brl(real)));
        }
        return td;
      };
      const mes = el('td', {});
      mes.append(el('b', {}, F.mes(p.mes)), el('div', {class: 'sub'}, p.situacao));
      const dif = p.sobra_real == null ? null : p.sobra_real - p.aporte_prev;
      tr.append(mes, par(p.renda_prev, p.renda_real), par(p.gasto_prev, p.gasto_real, true), par(p.aporte_prev, p.sobra_real),
        el('td', {class: 'n ' + (dif == null || p.situacao !== 'fechado' ? 'iv-muted' : dif >= 0 ? 'iv-pos' : 'iv-neg')}, dif == null ? '—' : sinal(dif)),
        el('td', {class: 'iv-muted'}, p.destino), el('td', {class: 'n'}, brl(p.saldo_prev)));
      return tr;
    }));
  }

  function metas() {
    const d = dash.data('plano_metas_resumo'), tb = document.querySelector('#pl-metas-tab tbody');
    if (d.status !== 'ok') { tb.replaceChildren(); return; }
    tb.replaceChildren(...d.data.map((m) => {
      const tr = el('tr', {});
      const cel = (v) => el('td', {class: 'n ' + (v == null ? 'iv-muted' : v <= m.meta ? 'iv-pos' : 'iv-neg')}, brl(v));
      tr.append(el('td', {}, m.categoria), el('td', {class: 'n'}, brl(m.meta)), cel(m.mes_atual), cel(m.media_fechados), el('td', {class: 'n iv-muted'}, brl(m.antes)));
      return tr;
    }));
  }

  function grafico() {
    const host = document.getElementById('pl-ch'), d = dash.data('plano');
    if (!visivel()) return;
    if (d.status !== 'ok' || !d.data.length) { host.replaceChildren(); return; }
    const rows = d.data, W = Math.max(300, host.clientWidth), H = 280, T = 14, B = 24;
    host.innerHTML = '';
    const svg = d3.select(host).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`);
    const medir = (txt) => { const n = svg.append('text').text(txt); const w = n.node().getComputedTextLength(); n.remove(); return w; };
    const vals = rows.flatMap((r) => [r.aporte_prev, r.sobra_real ?? 0, r.acumulado_prev, r.acumulado_real ?? 0]);
    const y = d3.scaleLinear([Math.min(0, d3.min(vals)), d3.max(vals) * 1.08], [H - B, T]).nice(5);
    const fmt = (v) => (v / 1000).toLocaleString('pt-BR') + 'k';
    const L = 10 + d3.max(y.ticks(5), (v) => medir(fmt(v)));
    const x = d3.scaleBand(rows.map((r) => r.mes), [L, W]).padding(0.25);
    y.ticks(5).forEach((v) => {
      svg.append('line').attr('x1', L).attr('x2', W).attr('y1', y(v)).attr('y2', y(v)).attr('stroke', v === 0 ? 'var(--cds-chart-axis)' : 'var(--cds-chart-grid)');
      svg.append('text').attr('x', L - 6).attr('y', y(v) + 4).attr('text-anchor', 'end').text(fmt(v));
    });
    const bw = Math.min(16, x.bandwidth() / 2 - 1), y0 = y(0);
    let tip = host.querySelector('.pf-tip'); if (!tip) { tip = el('div', {class: 'pf-tip'}); host.appendChild(tip); }
    rows.forEach((r) => {
      const cx = x(r.mes) + x.bandwidth() / 2;
      const barra = (v, dx, cor) => { if (v == null) return; svg.append('rect').attr('x', cx + dx).attr('width', bw).attr('y', Math.min(y0, y(v))).attr('height', Math.max(1, Math.abs(y(v) - y0))).attr('rx', 3).attr('fill', cor); };
      barra(r.aporte_prev, -bw - 1, 'var(--cds-chart-muted)');
      barra(r.sobra_real, 1, r.sobra_real != null && r.sobra_real < 0 ? 'var(--cds-chart-status-critical)' : dash.colors[0]);
      svg.append('text').attr('x', cx).attr('y', H - 6).attr('text-anchor', 'middle').text(F.mes(r.mes));
      svg.append('rect').attr('x', x(r.mes)).attr('width', x.bandwidth()).attr('y', T).attr('height', H - T - B).attr('fill', 'transparent')
        .on('mousemove', (ev) => {
          tip.innerHTML = `<div class="t">${F.mes(r.mes)} · ${r.situacao}</div><div class="r"><span>Aporte previsto</span><span>${brl(r.aporte_prev)}</span></div><div class="r"><span>Sobra real</span><span>${brl(r.sobra_real)}</span></div><div class="r"><span>Acumulado previsto</span><span>${brl(r.acumulado_prev)}</span></div><div class="r"><span>Acumulado real</span><span>${brl(r.acumulado_real)}</span></div>`;
          tip.style.opacity = 1;
          const b = host.getBoundingClientRect();
          tip.style.left = Math.max(0, Math.min(ev.clientX - b.left + 12, b.width - tip.offsetWidth)) + 'px';
          tip.style.top = Math.max(0, Math.min(ev.clientY - b.top + 12, b.height - tip.offsetHeight)) + 'px';
        })
        .on('mouseleave', () => { tip.style.opacity = 0; });
    });
    const linha = (k, cor, tracejado) => {
      const pts = rows.filter((r) => r[k] != null);
      if (!pts.length) return;
      const p = svg.append('path').attr('d', d3.line().x((r) => x(r.mes) + x.bandwidth() / 2).y((r) => y(r[k]))(pts)).attr('fill', 'none').attr('stroke', cor).attr('stroke-width', 2).attr('pointer-events', 'none');
      if (tracejado) p.attr('stroke-dasharray', '5 4');
      const u = pts[pts.length - 1];
      svg.append('circle').attr('cx', x(u.mes) + x.bandwidth() / 2).attr('cy', y(u[k])).attr('r', 4).attr('fill', cor).attr('stroke', 'var(--color-panel)').attr('stroke-width', 2).attr('pointer-events', 'none');
    };
    linha('acumulado_prev', 'var(--color-fg)', true);
    linha('acumulado_real', dash.colors[0], false);
  }

  window.pfDraw = window.pfDraw || {};
  window.pfDraw.plano = grafico;
  dash.onData(() => { kpis(); tabela(); metas(); grafico(); });
})();
